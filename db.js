const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./tareas.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS tareas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT,
      tarea TEXT,
      descripcion TEXT,
      fecha_entrega TEXT
    )
  `);
});

module.exports = db;
