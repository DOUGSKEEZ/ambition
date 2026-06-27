// Daily digest email. Builds one HTML+text message with three sections — NEW roles (opened +
// reopened), CLOSED roles, and DUE FOR RE-APPLY — and sends it via generic SMTP. Runs as a daily
// "heartbeat": it sends every scheduled scan even with no changes, showing "None" per empty section
// so you always know the 7am run happened. NEVER throws: a mail outage must not fail the pipeline,
// and a missing SMTP_USER/PASS simply disables sending.
import nodemailer from 'nodemailer';
import { SOURCES } from './sources.js';

const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

// Map a source key (e.g. 'anthropic') to its display label (e.g. 'Anthropic'); fall back to the key.
const COMPANY_LABEL = Object.fromEntries(SOURCES.map((s) => [s.key, s.label]));
const companyLabel = (src) => COMPANY_LABEL[src] || src;


let transport;
function getTransport() {
  if (transport !== undefined) return transport;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) { transport = null; return null; } // email disabled
  transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,        // 587 = STARTTLS
    requireTLS: true,
    auth: { user, pass },
  });
  return transport;
}

// Each role line is prefixed with its company, e.g. "Anthropic - Account Executive, AI Native — SF".
const roleLi = (r, extra = '') => {
  const where = r.location ? ` — ${esc(r.location)}` : '';
  const link = r.url ? ` <a href="${esc(r.url)}">↗ view</a>` : '';
  return `<li><strong>${esc(companyLabel(r.source))} -</strong> ${esc(r.title)}${where}${extra}${link}</li>`;
};
const roleText = (r, extra = '') =>
  `  • ${companyLabel(r.source)} - ${r.title}${r.location ? ` — ${r.location}` : ''}${extra}${r.url ? `  ${r.url}` : ''}`;

// Render a section, always including it (heartbeat) — "None" when empty.
const sectionHtml = (heading, roles, render) =>
  `<h3>${heading} (${roles.length})</h3>` +
  (roles.length ? `<ul>${roles.map(render).join('')}</ul>` : '<p style="margin:2px 0 12px;color:#888">None</p>');
const sectionText = (heading, roles, render) =>
  `${heading} (${roles.length})\n${roles.length ? roles.map(render).join('\n') : '  None'}`;

function buildBodies(summary) {
  const newRoles = [...summary.opened, ...summary.reopened];
  const closed = summary.closed;
  const due = summary.dueForReapply;

  const tag = (r) => ` <em>(${r.days_since_applied}d since last apply)</em>`;
  const tagText = (r) => ` (${r.days_since_applied}d since last apply)`;

  const html = [
    sectionHtml('🆕 New roles', newRoles, (r) => roleLi(r)),
    sectionHtml('🚫 Closed roles', closed, (r) => roleLi(r)),
    sectionHtml('⏰ Due for re-apply', due, (r) => roleLi(r, tag(r))),
  ].join('');
  const text = [
    sectionText('NEW ROLES', newRoles, (r) => roleText(r)),
    sectionText('CLOSED ROLES', closed, (r) => roleText(r)),
    sectionText('DUE FOR RE-APPLY', due, (r) => roleText(r, tagText(r))),
  ].join('\n\n');

  return {
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${html}</div>`,
    text,
    newCount: newRoles.length, closedCount: closed.length, dueCount: due.length,
  };
}

// Send the daily digest (heartbeat — sends even with no changes). Returns true if a mail was sent,
// false if SMTP is unconfigured or the send errored.
export async function sendDigest(summary) {
  try {
    const { html, text, newCount, closedCount, dueCount } = buildBodies(summary);

    const tx = getTransport();
    if (!tx) { console.log('[uav notify] SMTP not configured — skipping email'); return false; }

    const bits = [];
    if (newCount) bits.push(`${newCount} new`);
    if (closedCount) bits.push(`${closedCount} closed`);
    if (dueCount) bits.push(`${dueCount} to re-apply`);
    const subject = bits.length ? `UAV: ${bits.join(' / ')}` : 'UAV: no changes today';

    await tx.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.SMTP_TO || process.env.SMTP_USER,
      subject,
      text,
      html,
    });
    console.log(`[uav notify] sent: ${subject}`);
    return true;
  } catch (err) {
    console.error('[uav notify] send failed:', err?.message);
    return false;
  }
}
