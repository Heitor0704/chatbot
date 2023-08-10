const http = require("http")
const express = require("express")
const qrcode = require("qrcode")
const socketIO = require("socket.io")
const { rm } = require("fs")
const fs = require("fs");
const axios = require('axios');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, delay } = require('baileys')
const pino = require('pino')
const { Console } = require("console")
const port =  process.env.PORT || 3000;
const app = express()
const server = http.createServer(app)
const io = socketIO(server)

var mensagem = "";

app.use(express.json())
app.use("/assets", express.static(__dirname + "/views/assets"))

app.get("/", (req, res) => {
  res.sendFile("./views/index.html", {
    root: __dirname,
  })
})

let qr
let sock
let connected
let wa
var url = "https://script.google.com/macros/s/AKfycbzH1fmrq-uLzbYGvw97BtCIj_O_NFwqgOGkBie_efDBoOfHmD62g3Zc8YHFf0nvMJGg/exec?";

const sendMessageWTyping = async (waSock, msg, jid) => {
  await waSock.presenceSubscribe(jid)
  await delay(500)
  await waSock.sendPresenceUpdate('composing', jid)
  await delay(2000)
  await waSock.sendPresenceUpdate('paused', jid)
  await waSock.sendMessage(jid, msg)
}

function connectionUpdate(update) {
  const setQR = qr => {
    qrcode.toDataURL(qr, (err, url) => {
      sock?.emit("qr", url)
      sock?.emit("log","Escaneie o QR Code")

      //Copiando o QRCode para a pasta TEMP
      var img = url.replace(/^data:image\/\w+;base64,/, "");
      var imgbuf = Buffer.from(img, 'base64');
      fs.writeFile("../temp/chatbot-"+port+".png", imgbuf, { overwrite: true }, function (err) {
      if (err) throw err;
        console.log('QR registrado.');
      });
      
    })
  }

  if (update.qr) {
    qr = update.qr
    setQR(qr)
  }

  if (update === 'qr') {
    setQR(qr)
  }

  if (update.connection === 'open' || update === 'connected') {
     connected = true
    qr = ''
    sock?.emit("qrstatus", "./assets/check.svg")
    sock?.emit("log", "WhatsApp conectado!")

    //Deletando QRCode da pasta TEMP
    fs.stat("../temp/chatbot-"+port+".png", function (err, stats) {
      if(err){}
      else{fs.unlink("../temp/chatbot-"+port+".png",function(err){
      if(err){}
      else{console.log('Qr Code deletado com sucesso.');}});
      }
   });
    
  }

  if (update.connection === 'close') {
    connected = false
    sock?.emit("qrstatus", "./assets/loader.gif")
  }
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const waSock = makeWASocket({
    printQRInTerminal: true,
    browser: ["Eschema", "Chrome", "1.2.0"],
    auth: state,
    logger: pino({
      level: 'error'
    })
  })

  waSock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update
    if (connection === 'close') {
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        connectToWhatsApp()
      } else {
        console.log('Conexão perdida. Restabelecendo conexão...')
        rm("./auth", { recursive: true }, (err) => {
          if (err && err.code == "ENOENT") {
            // file doens't exist
            console.info("QR Code inválido. Gerando novo QR Code...");
          } else if (err) {
            console.error("Erro ao remover a autenticação. Faça a remoção manualmente!");
            console.error(err)
          }
        })
        connectToWhatsApp()
      }
    }

    connectionUpdate(update)
  })

  waSock.ev.on('creds.update', async () => {
    await saveCreds()
  })

  wa = waSock

   
   //Recebendo mensagens

  waSock.ev.on("messages.upsert", async ({ messages }) => {
    const baileysMessage = messages[0];
    const textMessage = baileysMessage.message?.conversation;
    const extendedTextMessage = baileysMessage.message?.extendedTextMessage?.text;
    const imageTextMessage = baileysMessage.message?.imageMessage?.caption;
    const videoTextMessage = baileysMessage.message?.videoMessage?.caption;
    const fullMessage =
    textMessage || extendedTextMessage || imageTextMessage || videoTextMessage;
  if(fullMessage!==mensagem && !baileysMessage.key.fromMe)
  {
    mensagem = fullMessage;
    var contato = baileysMessage.key.remoteJid.substring(0,baileysMessage.key.remoteJid.indexOf("@"));
    var data = new Date();
    axios.get(url+"mensagem="+fullMessage+"&telefone="+contato+"&nome="+baileysMessage.pushName+"&data="+data.toDateString())
      .then(response => {
      })
  }
  })
}


connectToWhatsApp()

io.on("connection", async (socket) => {
  sock = socket
  if (connected) {
    connectionUpdate("connected")
  } 
  else if (qr) connectionUpdate('qr')
})


//Enviando mensagens
app.post("/send-message", async (req, res) => {
  const message = req.body.message
  const number = req.body.number
  if (connected) {
    wa.onWhatsApp(number)
      .then(data => {
        if (data[0]?.jid) {
          sendMessageWTyping(wa, { text: message }, data[0].jid)
            .then((result) => {
              res.status(200).json({
                status: true,
                response: result,
              })
            })
            .catch((err) => {
              res.status(500).json({
                status: false,
                response: err,
              })
            })
        } else {
          res.status(500).json({
            status: false,
            response: `Número ${number} não possui registro no WhatsApp.`,
          })
        }
      })
      .catch(async err => {
        console.log(err)
        if (err?.output?.statusCode === DisconnectReason.connectionClosed) {
          console.log('WhatsApp desconectado')
        }
      })
  }
})

server.listen(port, () => {
  console.log(`Servidor rodando em: http://localhost:${port}`)
})
