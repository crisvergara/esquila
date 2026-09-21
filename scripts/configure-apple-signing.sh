#!/bin/bash
# Run in a private local terminal. Secrets are read silently, never printed,
# persisted in this repository, or passed as command-line arguments.
set -euo pipefail
set +x
repo=crisvergara/esquila
read -r -p 'Path to Developer ID Application certificate exported as .p12: ' certificate
if [[ ! -f "$certificate" ]]; then echo 'Certificate file not found.' >&2; exit 1; fi
read -r -s -p 'Certificate export password: ' certificate_password
printf '\n'
read -r -p 'Apple account email: ' apple_id
read -r -p 'Apple Team ID (10 characters): ' team_id
if [[ ! "$team_id" =~ ^[A-Z0-9]{10}$ ]]; then echo 'Invalid Team ID.' >&2; exit 1; fi
read -r -s -p 'Apple app-specific password for notarization: ' apple_password
printf '\n'
[[ -n "$certificate_password" && -n "$apple_id" && -n "$apple_password" ]]
base64 < "$certificate" | tr -d '\r\n' | gh secret set MAC_CSC_LINK --repo "$repo"
printf %s "$certificate_password" | gh secret set MAC_CSC_KEY_PASSWORD --repo "$repo"
printf %s "$apple_id" | gh secret set APPLE_ID --repo "$repo"
printf %s "$team_id" | gh secret set APPLE_TEAM_ID --repo "$repo"
printf %s "$apple_password" | gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo "$repo"
unset certificate_password apple_password
echo 'Signing credentials saved to GitHub Actions. A signed release still must pass notarization and installer checks.'
