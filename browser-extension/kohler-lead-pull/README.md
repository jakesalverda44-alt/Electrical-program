# Kohler Lead → CRM

Chrome extension. Adds a floating "Pull into CRM" button on Kohler PartnerHQ
opportunity pages (`home-energy.my.site.com/partnerhq/s/opportunity/...`).
Click it and the lead's name/phone/email/address gets posted straight into
the CRM as a new lead (source `kohler`), deduped on the opportunity's
Salesforce ID so clicking twice on the same lead never makes a duplicate.

## One-time setup

1. **API key.** Copy `config.example.js` to `config.js` and set `CRM_API_KEY`
   to the `AUTOMATION_API_KEY` value from the Render dashboard
   (accurate-power-crm → Environment).

   `config.js` is gitignored on purpose: that key authorizes lead creation
   against the live CRM, and committing it would put it in the repo's history
   permanently. Chrome loads `config.js`, so an existing working install
   needs no changes.

2. **Load the extension in Chrome.**
   - Go to `chrome://extensions`
   - Turn on **Developer mode** (top right)
   - Click **Load unpacked**
   - Select this folder: `browser-extension/kohler-lead-pull`

That's it — no build step, no npm install.

## Using it

Open any lead's opportunity page in Kohler PartnerHQ. A blue **"Pull into
CRM"** button appears in the bottom-right corner. Click it:

- Green ✓ = lead created (or updated) in the CRM.
- Red = failed — hover/read the button text for the reason, click to retry.

## If Kohler changes their page layout

This reads Salesforce Lightning fields by their component type, not by
CSS classes (those are auto-generated and unstable), so small layout tweaks
on Kohler's end usually won't break it. If the button ever stops finding a
field, the fix is almost always in `content.js`'s `extractLead()` function —
grab the new field's HTML (right-click → Inspect → Copy outerHTML) the same
way this was originally built, from the field the button can't find.

## Rotating the API key

If the key ever leaks or needs rotating: generate a new one, update it in
both the Render dashboard (`AUTOMATION_API_KEY`) and `config.js` in this
folder, then reload the extension at `chrome://extensions`.
