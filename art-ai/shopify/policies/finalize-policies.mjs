import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const policies = JSON.parse(fs.readFileSync(path.join(dir, 'policy-drafts.json'), 'utf8'));
const get = slug => policies.find(p => p.slug === slug);
const section = (slug, title, text) => { get(slug).sections.find(s => s[0] === title)[1] = text; };
section('refund-policy', 'Who we are', 'the dark matters is a UK-based fine-art store. For cancellations, damaged orders or download support, contact hello@thedarkmatters.art. Please include your order number and the email address used at checkout. These terms do not limit any rights you have under applicable consumer law.');
get('refund-policy').sections.find(s => s[0] === 'Standard physical prints: changing your mind')[1] = get('refund-policy').sections.find(s => s[0] === 'Standard physical prints: changing your mind')[1].replace('within 14 days after delivery', 'before delivery or within 14 days after delivery');
get('refund-policy').sections.find(s => s[0] === 'Return procedure and costs')[1] = get('refund-policy').sections.find(s => s[0] === 'Return procedure and costs')[1].replace('Email hello@thedarkmatters.art or send a clear cancellation statement to our business postal address.', 'Send a clear cancellation statement to hello@thedarkmatters.art.');
section('refund-policy', 'Optional cancellation form', 'To: the dark matters, hello@thedarkmatters.art.\nI/we give notice that I/we cancel my/our contract for the following goods or digital content: __________.\nOrdered on / received on: __________.\nOrder number: __________.\nCustomer name and address: __________.\nSignature, only if sent on paper: __________.\nDate: __________.');
section('terms-of-service', 'About The Dark Matters', 'the dark matters is a UK-based fine-art store. Customer service: hello@thedarkmatters.art. These terms apply to purchases through our Shopify store and associated storefront domain.');
section('terms-of-service', 'Complaints and applicable law', 'Contact hello@thedarkmatters.art so we can investigate a complaint. These terms are subject to the law applicable to your purchase. Nothing in them removes mandatory consumer protections or court rights available under that law, including protections that apply in your place of residence. We do not require consumers to use a foreign court or waive statutory remedies.');
get('shipping-and-digital-delivery').sections.find(s => s[0] === 'US orders and shipment delays')[1] += ' Refunds required under the US shipment-delay rule are issued within the applicable deadline, normally within seven working days; your payment provider may take additional time to display the credit.';
for (const p of policies) for (const s of p.sections) s[1] = s[1].replaceAll('The Dark Matters', 'the dark matters');
const outputDir = path.join(dir, 'final');
fs.mkdirSync(outputDir, { recursive: true });
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const links = {
  'Refund and Cancellation Policy': '/policies/refund-policy',
  'Shipping and Digital Delivery Policy': '/policies/shipping-policy',
  'Intellectual Property and Personal-Use Licence': '/policies/legal-notice',
  'Privacy Policy': '/policies/privacy-policy'
};
for (const p of policies.filter(p => p.slug !== 'privacy-policy')) {
  let html = '<p>Effective date: 12 September 2026</p>\n' + p.sections.map(([h,t]) => '<h2>' + escape(h) + '</h2>\n' + t.split('\n').map(line => '<p>' + escape(line) + '</p>').join('\n')).join('\n');
  if (p.slug === 'contact-information') html = '<h2>Customer service</h2><p><a href="mailto:hello@thedarkmatters.art">hello@thedarkmatters.art</a></p>';
  else html = html.replaceAll('hello@thedarkmatters.art', '<a href="mailto:hello@thedarkmatters.art">hello@thedarkmatters.art</a>');
  for (const [label, url] of Object.entries(links)) html = html.replaceAll(label, '<a href="' + url + '">' + label + '</a>');
  fs.writeFileSync(path.join(outputDir, p.slug + '.html'), html);
  fs.writeFileSync(path.join(outputDir, p.slug + '.md'), '# ' + p.title + '\n\nEffective date: 12 September 2026\n\n' + p.sections.map(([h,t]) => '## ' + h + '\n\n' + t).join('\n\n') + '\n');
}
fs.writeFileSync(path.join(outputDir, 'policy-content.json'), JSON.stringify(policies.filter(p => p.slug !== 'privacy-policy'), null, 2));
console.log('Finalized five policies. Privacy is being reconciled with verified Shopify settings.');
