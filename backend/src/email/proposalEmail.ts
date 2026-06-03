export function proposalEmailHtml(opts: {
  customerName: string;
  proposalNo: string;
  total: string;
  deposit: string;
  link: string;
  senderNote?: string;
}): string {
  const { customerName, proposalNo, total, deposit, link, senderNote } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Generator Proposal</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <!-- Header -->
        <tr>
          <td style="background:#1B3A6B;padding:28px 36px;">
            <div style="font-size:20px;font-weight:900;color:#ffffff;letter-spacing:.02em;">Accurate Power &amp; Technology</div>
            <div style="font-size:12px;color:#93C5FD;margin-top:4px;">EC13007737 · CFC1430965 · LI45063</div>
            <div style="height:3px;background:#D4AF37;margin-top:14px;border-radius:2px;width:60px;"></div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 36px;">
            <p style="font-size:15px;color:#1e293b;margin:0 0 16px;">Dear ${customerName},</p>
            <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 24px;">
              Thank you for the opportunity to earn your business. Please find your generator proposal attached below.${senderNote ? ' ' + senderNote : ''}
            </p>

            <!-- Proposal card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:28px;">
              <tr>
                <td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
                  <span style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Proposal</span>
                  <div style="font-size:14px;font-weight:700;color:#1e293b;margin-top:4px;">${proposalNo}</div>
                </td>
                <td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;text-align:right;">
                  <span style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Total</span>
                  <div style="font-size:22px;font-weight:900;color:#1B3A6B;margin-top:4px;">${total}</div>
                </td>
              </tr>
              <tr>
                <td colspan="2" style="padding:12px 20px;">
                  <span style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Deposit at Signing</span>
                  <div style="font-size:14px;font-weight:700;color:#1e293b;margin-top:4px;">${deposit}</div>
                </td>
              </tr>
            </table>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
              <tr>
                <td style="background:#1B3A6B;border-radius:8px;text-align:center;">
                  <a href="${link}" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:.02em;">
                    View &amp; Sign Proposal →
                  </a>
                </td>
              </tr>
            </table>

            <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0 0 8px;">
              This proposal is valid for 30 days.
            </p>
            <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0;">
              Questions? Reply to this email or call us directly.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:18px 36px;border-top:1px solid #e2e8f0;">
            <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.6;">
              Accurate Power &amp; Technology, Inc. · Florida Licensed Electrical Contractor<br>
              EC13007737 · CFC1430965 · LI45063
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function proposalEmailText(opts: {
  customerName: string;
  proposalNo: string;
  total: string;
  link: string;
}): string {
  return `Dear ${opts.customerName},

Thank you for the opportunity. Please review your generator proposal below.

Proposal: ${opts.proposalNo}
Total: ${opts.total}

View and sign your proposal:
${opts.link}

This proposal is valid for 30 days. Reply to this email with any questions.

Accurate Power & Technology, Inc.
EC13007737 · CFC1430965 · LI45063
`;
}
