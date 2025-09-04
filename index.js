const express = require('express');
const db = require('./db');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// Configuración de WhatsApp Business API
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // Token de Meta
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // ID del número de teléfono
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN; // Token de verificación
const YOUR_PHONE_NUMBER = process.env.YOUR_PHONE_NUMBER; // Tu número (ej: "573115850689")

// Verificación del webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// Recibir mensajes
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    body.entry.forEach(entry => {
      const changes = entry.changes;
      changes.forEach(change => {
        if (change.field === 'messages') {
          const messages = change.value.messages;
          if (messages) {
            messages.forEach(message => {
              handleMessage(message, change.value.contacts[0]);
            });
          }
        }
      });
    });
    res.status(200).send('OK');
  } else {
    res.status(404).send('Not Found');
  }
});

// Función para enviar mensajes
async function sendMessage(to, text) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: { body: text }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    return await response.json();
  } catch (error) {
    console.error('Error enviando mensaje:', error);
  }
}

// Estado temporal para "marcar tarea"
let enModoMarcar = {};

// Manejar mensajes recibidos
async function handleMessage(message, contact) {
  const from = message.from;
  const text = message.text?.body?.toLowerCase() || '';
  
  // Solo responder a tu número
  if (from !== YOUR_PHONE_NUMBER) return;

  // 📌 Agregar tarea
  if (text === "agregar tarea") {
    await sendMessage(from, "📌 Para agregar una tarea usa el formato:\n\nAgregar tarea;FECHA;TAREA;DESCRIPCION;FECHA_ENTREGA\n\nEjemplo:\nAgregar tarea;2025-09-01;Estudiar;Repasar álgebra;2025-09-05");
    return;
  }

  if (text.startsWith("agregar tarea;")) {
    const partes = message.text.body.split(";");
    if (partes.length < 5) {
      await sendMessage(from, "❌ Formato incorrecto.\nEjemplo:\nAgregar tarea;2025-09-01;Estudiar;Repasar álgebra;2025-09-05");
      return;
    }
    const [, fecha, tarea, descripcion, fechaEntrega] = partes;

    db.run(
      "INSERT INTO tareas (fecha, tarea, descripcion, fecha_entrega) VALUES (?, ?, ?, ?)",
      [fecha, tarea, descripcion, fechaEntrega],
      async (err) => {
        if (err) await sendMessage(from, "⚠️ Error al guardar la tarea");
        else await sendMessage(from, "✅ Tarea guardada!");
      }
    );
    return;
  }

  // 📌 Listar tareas
  if (text === "listar tareas") {
    db.all("SELECT * FROM tareas", [], async (err, rows) => {
      if (err) {
        await sendMessage(from, "⚠️ Error al consultar las tareas");
        return;
      }
      if (rows.length === 0) {
        await sendMessage(from, "📭 No tienes tareas registradas");
        return;
      }
      let respuesta = "📋 *Tus tareas:*\n\n";
      rows.forEach(r => {
        respuesta += `🆔 ${r.id}\n📅 ${r.fecha}\n📌 ${r.tarea}\n📝 ${r.descripcion}\n⏳ Entrega: ${r.fecha_entrega}\n---\n`;
      });
      await sendMessage(from, respuesta);
    });
    return;
  }

  // 📌 Marcar tarea realizada
  if (text === "marcar tarea realizada") {
    db.all("SELECT * FROM tareas", [], async (err, rows) => {
      if (err) {
        await sendMessage(from, "⚠️ Error al consultar las tareas");
        return;
      }
      if (rows.length === 0) {
        await sendMessage(from, "📭 No tienes tareas registradas");
        return;
      }
      let respuesta = "✅ *Selecciona el número de la tarea realizada:*\n\n";
      rows.forEach((r, i) => {
        respuesta += `${i + 1}. 📌 ${r.tarea} (Entrega: ${r.fecha_entrega})\n`;
      });
      await sendMessage(from, respuesta);
      enModoMarcar[from] = true;
    });
    return;
  }

  // 📌 Si está en modo "marcar" y el usuario envía un número
  if (enModoMarcar[from] && !isNaN(text)) {
    const numero = parseInt(text);
    db.all("SELECT * FROM tareas", [], async (err, rows) => {
      if (err) {
        await sendMessage(from, "⚠️ Error al consultar las tareas");
        enModoMarcar[from] = false;
        return;
      }
      if (numero < 1 || numero > rows.length) {
        await sendMessage(from, "❌ Número inválido, intenta de nuevo.");
        return;
      }
      const tareaSeleccionada = rows[numero - 1];
      db.run("DELETE FROM tareas WHERE id = ?", [tareaSeleccionada.id], async function (err) {
        if (err) await sendMessage(from, "⚠️ Error al eliminar tarea");
        else await sendMessage(from, `🗑️ Tarea realizada y eliminada: ${tareaSeleccionada.tarea}`);
        enModoMarcar[from] = false;
      });
    });
    return;
  }

  // 📌 Eliminar tarea por ID
  if (text.startsWith("eliminar tarea")) {
    const partes = message.text.body.split(" ");
    if (partes.length < 3) {
      await sendMessage(from, "❌ Usa: Eliminar tarea ID");
      return;
    }
    const id = partes[2];
    db.run("DELETE FROM tareas WHERE id = ?", [id], async function (err) {
      if (err) await sendMessage(from, "⚠️ Error al eliminar tarea");
      else if (this.changes === 0) await sendMessage(from, "❌ No existe esa tarea");
      else await sendMessage(from, "🗑️ Tarea eliminada");
    });
    return;
  }

  // 📌 Ayuda
  if (text === "ayuda") {
    await sendMessage(from,
      "🤖 *Bot de Tareas*\n\n" +
      "👉 Agregar tarea (te muestra el formato)\n" +
      "👉 Agregar tarea;FECHA;TAREA;DESCRIPCION;FECHA_ENTREGA\n" +
      "👉 Listar tareas\n" +
      "👉 Marcar tarea realizada\n" +
      "👉 Eliminar tarea ID\n" +
      "👉 Ayuda"
    );
  }
}

// Programar recordatorios (8 AM)
cron.schedule("0 8 * * *", async () => {
  db.all("SELECT * FROM tareas", [], async (err, rows) => {
    if (err) {
      await sendMessage(YOUR_PHONE_NUMBER, "⚠️ Error al consultar las tareas.");
      return;
    }
    if (rows.length === 0) {
      await sendMessage(YOUR_PHONE_NUMBER, "📭 No tienes tareas pendientes hoy.");
      return;
    }
    let respuesta = "🌞 *Buenos días!* Aquí están tus tareas pendientes:\n\n";
    rows.forEach((r, i) => {
      respuesta += `${i + 1}. 📌 ${r.tarea} (Entrega: ${r.fecha_entrega})\n`;
    });
    await sendMessage(YOUR_PHONE_NUMBER, respuesta);
  });
});

app.get('/', (req, res) => {
  res.send('Bot de WhatsApp Business API funcionando 🚀');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});