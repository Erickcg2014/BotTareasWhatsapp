const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const db = require("./db");
const cron = require("node-cron");

const express = require("express");
const app = express();


const client = new Client({
  authStrategy: new LocalAuth()
});

app.get("/", (req, res) => {
  res.send("Bot de WhatsApp corriendo 🚀");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor web activo en Render");
});

// Estado temporal para "marcar tarea"
let enModoMarcar = false;

client.on("qr", qr => {
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ Bot de tareas listo y conectado a WhatsApp!");
});

//PROGRAMAR 8 A.M RECORDATORIOS
// Enviar lista de tareas todos los días a las 8:00 am
cron.schedule("0 8 * * *", () => {
  const chatId = "573208880658@c.us";

  db.all("SELECT * FROM tareas", [], (err, rows) => {
    if (err) {
      client.sendMessage(chatId, "⚠️ Error al consultar las tareas.");
      return;
    }
    if (rows.length === 0) {
      client.sendMessage(chatId, "📭 No tienes tareas pendientes hoy.");
      return;
    }
    let respuesta = "🌞 *Buenos días!* Aquí están tus tareas pendientes:\n\n";
    rows.forEach((r, i) => {
      respuesta += `${i + 1}. 📌 ${r.tarea} (Entrega: ${r.fecha_entrega})\n`;
    });
    client.sendMessage(chatId, respuesta);
  });
});


client.on("message", async msg => {
  const text = msg.body.toLowerCase();

  // 📌 Agregar tarea
  if (text === "agregar tarea") {
    msg.reply("📌 Para agregar una tarea usa el formato:\n\nAgregar tarea;FECHA;TAREA;DESCRIPCION;FECHA_ENTREGA\n\nEjemplo:\nAgregar tarea;2025-09-01;Estudiar;Repasar álgebra;2025-09-05");
    return;
  }

  if (text.startsWith("agregar tarea;")) {
    const partes = msg.body.split(";");
    if (partes.length < 5) {
      msg.reply("❌ Formato incorrecto.\nEjemplo:\nAgregar tarea;2025-09-01;Estudiar;Repasar álgebra;2025-09-05");
      return;
    }
    const [, fecha, tarea, descripcion, fechaEntrega] = partes;

    db.run(
      "INSERT INTO tareas (fecha, tarea, descripcion, fecha_entrega) VALUES (?, ?, ?, ?)",
      [fecha, tarea, descripcion, fechaEntrega],
      err => {
        if (err) msg.reply("⚠️ Error al guardar la tarea");
        else msg.reply("✅ Tarea guardada!");
      }
    );
    return;
  }

  // 📌 Listar tareas
  if (text === "listar tareas") {
    db.all("SELECT * FROM tareas", [], (err, rows) => {
      if (err) {
        msg.reply("⚠️ Error al consultar las tareas");
        return;
      }
      if (rows.length === 0) {
        msg.reply("📭 No tienes tareas registradas");
        return;
      }
      let respuesta = "📋 *Tus tareas:*\n\n";
      rows.forEach(r => {
        respuesta += `🆔 ${r.id}\n📅 ${r.fecha}\n📌 ${r.tarea}\n📝 ${r.descripcion}\n⏳ Entrega: ${r.fecha_entrega}\n---\n`;
      });
      msg.reply(respuesta);
    });
    return;
  }

  // 📌 Marcar tarea realizada
  if (text === "marcar tarea realizada") {
    db.all("SELECT * FROM tareas", [], (err, rows) => {
      if (err) {
        msg.reply("⚠️ Error al consultar las tareas");
        return;
      }
      if (rows.length === 0) {
        msg.reply("📭 No tienes tareas registradas");
        return;
      }
      let respuesta = "✅ *Selecciona el número de la tarea realizada:*\n\n";
      rows.forEach((r, i) => {
        respuesta += `${i + 1}. 📌 ${r.tarea} (Entrega: ${r.fecha_entrega})\n`;
      });
      msg.reply(respuesta);
      enModoMarcar = true;
    });
    return;
  }

  // 📌 Si está en modo "marcar" y el usuario envía un número
  if (enModoMarcar && !isNaN(text)) {
    const numero = parseInt(text);
    db.all("SELECT * FROM tareas", [], (err, rows) => {
      if (err) {
        msg.reply("⚠️ Error al consultar las tareas");
        enModoMarcar = false;
        return;
      }
      if (numero < 1 || numero > rows.length) {
        msg.reply("❌ Número inválido, intenta de nuevo.");
        return;
      }
      const tareaSeleccionada = rows[numero - 1];
      db.run("DELETE FROM tareas WHERE id = ?", [tareaSeleccionada.id], function (err) {
        if (err) msg.reply("⚠️ Error al eliminar tarea");
        else msg.reply(`🗑️ Tarea realizada y eliminada: ${tareaSeleccionada.tarea}`);
        enModoMarcar = false;
      });
    });
    return;
  }

  // 📌 Eliminar tarea por ID
  if (text.startsWith("eliminar tarea")) {
    const partes = msg.body.split(" ");
    if (partes.length < 3) {
      msg.reply("❌ Usa: Eliminar tarea ID");
      return;
    }
    const id = partes[2];
    db.run("DELETE FROM tareas WHERE id = ?", [id], function (err) {
      if (err) msg.reply("⚠️ Error al eliminar tarea");
      else if (this.changes === 0) msg.reply("❌ No existe esa tarea");
      else msg.reply("🗑️ Tarea eliminada");
    });
    return;
  }

  // 📌 Ayuda
  if (text === "ayuda") {
    msg.reply(
      "🤖 *Bot de Tareas*\n\n" +
      "👉 Agregar tarea (te muestra el formato)\n" +
      "👉 Agregar tarea;FECHA;TAREA;DESCRIPCION;FECHA_ENTREGA\n" +
      "👉 Listar tareas\n" +
      "👉 Marcar tarea realizada\n" +
      "👉 Eliminar tarea ID\n" +
      "👉 Ayuda"
    );
  }
});

client.initialize();
