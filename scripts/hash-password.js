// Usage: node scripts/hash-password.js "your password"
// Prints the value for the ADMIN_PASSWORD_HASH environment variable in Vercel.
const { hashPassword } = require('../api/_lib/auth');

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: node scripts/hash-password.js "your password"');
  process.exit(1);
}
console.log(hashPassword(pw));
