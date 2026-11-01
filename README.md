# HABITLY - CLOUD SYNC VERSION

Files in this folder:
- index.html
- style.css
- app.js

SETUP
1. Replace the existing three Habitly website files in your GitHub repository with these three files.
2. Commit/push the changes and wait for GitHub Pages to publish.
3. Open the website and sign in with the email address and password of the Supabase Auth user you created.
4. On first sign-in from the browser that already has your Habitly data, the app uploads that existing data to your private cloud account.
5. On your other device, open the same website and sign in with the same account. It loads the cloud data.

SECURITY
- The browser contains only the Supabase project URL and publishable key. This is expected for a frontend app.
- Never put a Supabase secret/service_role key or database password in these files.
- Row Level Security on public.tracker_data restricts each account to its own row.

SYNC
- Changes are saved to the cloud shortly after each update.
- When the app becomes visible/focused again, it refreshes from the cloud.
- Keep using the same Supabase account on all devices.
