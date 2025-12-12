// db-mysql.js
// Connexion MySQL OVH pour Battle of Dice

const mysql = require("mysql2/promise");

const {
  MYSQL_HOST,
  MYSQL_PORT,
  MYSQL_DATABASE,
  MYSQL_USER,
  MYSQL_PASSWORD,
} = process.env;

// Petit helper pour créer un pool de connexions
const pool = mysql.createPool({
  host: MYSQL_HOST,
  port: MYSQL_PORT ? Number(MYSQL_PORT) : 3306,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Fonctions de base pour requêter

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// --- Fonctions spécifiques "players" (on les branchera petit à petit) ---

async function getPlayerByWallet(wallet) {
  return queryOne("SELECT * FROM players WHERE wallet = ?", [wallet]);
}

async function createPlayerWithWallet(wallet) {
  // valeurs par défaut cohérentes avec ton SQLite
  const sql = `
    INSERT INTO players (
      wallet,
      nickname,
      gems,
      vip_level,
      hp_base,
      dmg_base,
      free_rolls,
      current_player_hp,
      current_bot_hp,
      current_bot_level,
      owned_cards_json
    )
    VALUES (?, NULL, 0, 0, 50, 0, 5, 50, 50, 1, '{}')
  `;
  const [result] = await pool.query(sql, [wallet]);
  const id = result.insertId;
  return queryOne("SELECT * FROM players WHERE id = ?", [id]);
}

async function updatePlayerState(playerId, fields) {
  // fields est un objet { colonne: valeur, ... }
  const keys = Object.keys(fields);
  if (!keys.length) return;

  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => fields[k]);

  const sql = `
    UPDATE players
    SET ${sets}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;
  values.push(playerId);
  await pool.query(sql, values);
}

module.exports = {
  pool,
  query,
  queryOne,
  getPlayerByWallet,
  createPlayerWithWallet,
  updatePlayerState,
};
