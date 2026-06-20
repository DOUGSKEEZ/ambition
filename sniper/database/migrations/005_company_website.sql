-- A company's website/domain. Used to auto-fetch its favicon (saved to media/company-icons/<id>.png)
-- on create/update so every app that serves /media can badge the company with its logo.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website TEXT;
