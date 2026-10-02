/**
 * Cria um administrador ou recupera o acesso de alguém, direto no servidor (sem precisar entrar na plataforma).
 *   npm run admin -- email@empresa.com.br "Nome da pessoa"
 * Se o e-mail já existe: gera uma senha provisória nova, vira administrador e o acesso é liberado.
 * Se não existe: cria a conta de administrador com uma senha provisória.
 * Em ambos os casos, a pessoa escolhe a própria senha no primeiro login.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/db.js';
import { createUsers } from '../server/auth.js';

const [email, ...nameParts] = process.argv.slice(2);
if (!email || !email.includes('@')) {
  console.error('Uso: npm run admin -- email@empresa.com.br "Nome da pessoa"');
  process.exit(1);
}
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = openDatabase(path.resolve(rootDir, process.env.DATA_DIR || 'data'));
const users = createUsers(db);
const existing = users.byEmail(email);
let password;
if (existing) {
  users.update(existing.id, { role: 'admin', active: true });
  password = users.resetPassword(existing.id);
  console.log(`Acesso de ${existing.email} recuperado: agora é administrador.`);
} else {
  ({ password } = users.create({ name: nameParts.join(' ') || email.split('@')[0], email, role: 'admin' }));
  console.log(`Administrador ${email.toLowerCase()} criado.`);
}
console.log(`Senha provisória: ${password}`);
console.log('Entre em /entrar com o e-mail e essa senha; a plataforma pede para criar uma senha nova.');
db.close();
