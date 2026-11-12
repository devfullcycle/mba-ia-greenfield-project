// Gera um access token de longa duração (10 anos) para os usuários da seed da Fase 03.
// Uso (dentro do container): node scripts/generate-dev-token.js [owner|other]
// Só para ambiente local: assina com JWT_SECRET do .env.
require('dotenv/config');
const jwt = require('jsonwebtoken');

const USERS = {
  owner: { sub: '00000000-0000-4000-8000-0000000000a1', email: 'dev@streamtube.local' },
  other: { sub: '00000000-0000-4000-8000-0000000000b1', email: 'other@streamtube.local' },
};

const name = process.argv[2] || 'owner';
if (!USERS[name]) {
  console.error('Usuário inválido. Use: owner | other');
  process.exit(1);
}
console.log(jwt.sign(USERS[name], process.env.JWT_SECRET, { expiresIn: '3650d' }));
