// db.js
// Gestion de la base SQLite (connexion + création / mise à jour de la table players)

const path = require("path");
const Database = require("better-sqlite3");

const DB_FILE = path.join(__dirname, "battle-of-dice.db");
const db = new Database(DB_FILE);

// 1) Création de base si la table n'existe pas du tout
const createPlayersTableSql = `
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL UNIQUE,
  nickname TEXT,
  gems INTEGER NOT NULL DEFAULT 0,
  vip_level INTEGER NOT NULL DEFAULT 0,
  hp_base INTEGER NOT NULL DEFAULT 50,
  dmg_base INTEGER NOT NULL DEFAULT 0,
  free_rolls INTEGER NOT NULL DEFAULT 5,
  owned_cards_json TEXT NOT NULL DEFAULT '{}',
  last_roll_reset_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;


db.exec(createPlayersTableSql);

// Migration : ajouter la colonne last_free_reset_at si elle n'existe pas
try {
  db.prepare(
    "ALTER TABLE players ADD COLUMN last_free_reset_at TEXT"
  ).run();
  console.log("✅ Colonne last_free_reset_at ajoutée à players");
} catch (e) {
  // Si la colonne existe déjà, SQLite renvoie "duplicate column name"
  if (!String(e.message).includes("duplicate column name")) {
    console.error("❌ Erreur migration last_free_reset_at :", e);
  }
}


// 2) Vérifier les colonnes existantes et ajouter celles manquantes
const cols = db.prepare("PRAGMA table_info(players)").all();
const colNames = cols.map((c) => c.name);

function ensureColumn(name, sql) {
  if (!colNames.includes(name)) {
    db.exec(sql);
    console.log(`🧩 Colonne ajoutée dans players : ${name}`);
  }
}

// Colonnes de progression de combat
ensureColumn(
  "current_player_hp",
  "ALTER TABLE players ADD COLUMN current_player_hp INTEGER NOT NULL DEFAULT 50;"
);
ensureColumn(
  "current_bot_hp",
  "ALTER TABLE players ADD COLUMN current_bot_hp INTEGER NOT NULL DEFAULT 50;"
);
ensureColumn(
  "current_bot_level",
  "ALTER TABLE players ADD COLUMN current_bot_level INTEGER NOT NULL DEFAULT 1;"
);
// Colonne inventaire de cartes
ensureColumn(
  "owned_cards_json",
  "ALTER TABLE players ADD COLUMN owned_cards_json TEXT NOT NULL DEFAULT '{}';"
);
// Potions
ensureColumn(
  "potions_attack",
  "ALTER TABLE players ADD COLUMN potions_attack INTEGER NOT NULL DEFAULT 0;"
);
ensureColumn(
  "potions_heal",
  "ALTER TABLE players ADD COLUMN potions_heal INTEGER NOT NULL DEFAULT 0;"
);


console.log("✅ Database initialisée / mise à jour :", DB_FILE);

function touchPlayer(playerId) {
  const stmt = db.prepare(
    "UPDATE players SET updated_at = datetime('now') WHERE id = ?"
  );
  stmt.run(playerId);
}

module.exports = {
  db,
  touchPlayer,
};
