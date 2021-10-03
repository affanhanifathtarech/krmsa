const { Client, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const { phoneNumberFormatter } = require('./helpers/formatter');
const axios = require('axios');
const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

const db = require('./helpers/db.js');

(async() => {

  app.get('/', (req, res) => {
    res.sendFile('index.html', {
      root: __dirname
    });
  });
  
  const savedSession = db.readSession();
  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
    },
    session: savedSession
  });
  
  client.on('message', async msg => {
    if (msg.body == '!ping') {
      msg.reply('pong');
    } else if (msg.body == '!groups') {
      client.getChats().then(chats => {
        const groups = chats.filter(chat => chat.isGroup);
  
        if (groups.length == 0) {
          msg.reply('You have no group yet.');
        } else {
          let replyMsg = '*YOUR GROUPS*\n\n';
          groups.forEach((group, i) => {
            replyMsg += `ID: ${group.id._serialized}\nName: ${group.name}\n\n`;
          });
          replyMsg += '_You can use the group id to send a message to the group._'
          msg.reply(replyMsg);
        }
      });
    } else if (msg.body.startsWith('!echo ')) {
      // Replies with the same message
      msg.reply(msg.body.slice(6));
    } else if (msg.body === '!leave') {
      // Leave the group
      let chat = await msg.getChat();
      if (chat.isGroup) {
          chat.leave();
      } else {
          msg.reply('This command can only be used in a group!');
      }
    } else if (msg.body.startsWith('!invite ')) {
        let chat = await msg.getChat();
        numbers = msg.body.slice(8)
        numbers = numbers.split(' ');
        
        for (i = 0; i < numbers.length; i++) {
            numbers[i] = '62' + numbers[i].slice(1) + '@c.us';
        }
        if (chat.isGroup) {
            chat.addParticipants(numbers);
        } else {
            msg.reply('This command can only be used in a group!');
        }
    } else if (msg.body === '!groupinfo') {
      let chat = await msg.getChat();
      if (chat.isGroup) {
          msg.reply(`
              *Group Details*
              Name: ${chat.name}
              Description: ${chat.description}
              Created At: ${chat.createdAt.toString()}
              Created By: ${chat.owner.user}
              Participant count: ${chat.participants.length}
          `);
      } else {
          msg.reply('This command can only be used in a group!');
      }
    } else if (msg.body === '!chats') {
        const chats = await client.getChats();
        client.sendMessage(msg.from, `The bot has ${chats.length} chats open.`);
    } else if (msg.body === '!info') {
        let info = client.info;
        client.sendMessage(msg.from, `
            *Connection info*
            User name: ${info.pushname}
            My number: ${info.me.user}
            Platform: ${info.platform}
            WhatsApp version: ${info.phone.wa_version}
        `);
    } 
  
  });
  
  client.initialize();
  
  // Socket IO
  io.on('connection', function(socket) {
    socket.emit('message', 'Mohon tunggu...');
    console.log('Mohon tunggu...');

    client.on('qr', (qr) => {
      console.log('Silakan scan QR Code!');
      qrcode.toDataURL(qr, (err, url) => {
        socket.emit('qr', url);
        socket.emit('message', 'Silakan scan QR Code!');
      });
    });
    
    client.on('ready', () => {
      socket.emit('ready', 'Whatsapp telah siap!');
      socket.emit('message', 'Whatsapp telah siap!');
      console.log('Whatsapp telah siap!');
    });
  
    client.on('authenticated', (session) => {
      socket.emit('authenticated', 'Whatsapp terautentikasi!');
      socket.emit('message', 'Whatsapp terautentikasi!');
      console.log('Whatsapp terautentikasi!');
      db.saveSession(session);
    });
  
    client.on('auth_failure', function(session) {
      socket.emit('message', 'Autentikasi gagal, memulai ulang...');
      console.log('Autentikasi gagal, memulai ulang...');
    });
  
    client.on('disconnected', (reason) => {
      socket.emit('message', 'Whatsapp terputus!');
      console.log('Whatsapp terputus!');
      db.removeSession();
      client.destroy();
      client.initialize();
    });
  
    socket.on('disconnected', (reason) => {
      socket.emit('message', 'Whatsapp terputus!');
      console.log('Whatsapp terputus!');
      db.removeSession();
      client.destroy();
      client.initialize();
    });

    socket.on('refresh', (reason) => {
      socket.emit('message', 'Refresh Whatsapp!');
      console.log('Refresh Whatsapp!');
      client.destroy();
      client.initialize();
    });
  });
  
  
  const checkRegisteredNumber = async function(number) {
    const isRegistered = await client.isRegisteredUser(number);
    return isRegistered;
  }
  
  // Send message
  app.post('/send-message', [
    body('number').notEmpty(),
    body('message').notEmpty(),
  ], async (req, res) => {
    const errors = validationResult(req).formatWith(({
      msg
    }) => {
      return msg;
    });
  
    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped()
      });
    }
  
    const number = phoneNumberFormatter(req.body.number);
    const message = req.body.message;
  
    const isRegisteredNumber = await checkRegisteredNumber(number);
  
    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: 'The number is not registered'
      });
    }
  
    client.sendMessage(number, message).then(response => {
      res.status(200).json({
        status: true,
        response: response
      });
    }).catch(err => {
      res.status(500).json({
        status: false,
        response: err
      });
    });
  });
  
  // Send media
  app.post('/send-media', async (req, res) => {
    const number = phoneNumberFormatter(req.body.number);
    const caption = req.body.message;
    const fileUrl = req.body.file;
    const nama_file = req.body.nama_file;
  
    let mimetype;
    const attachment = await axios.get(fileUrl, {
      responseType: 'arraybuffer'
    }).then(response => {
      mimetype = response.headers['content-type'];
      return response.data.toString('base64');
    });
  
    const media = new MessageMedia(mimetype, attachment, nama_file);
  
    client.sendMessage(number, media, {
      caption: caption
    }).then(response => {
      res.status(200).json({
        status: true,
        response: response
      });
    }).catch(err => {
      res.status(500).json({
        status: false,
        response: err
      });
    });
  });
  
  
  const findGroupByName = async function(name) {
    const group = await client.getChats().then(chats => {
      return chats.find(chat => 
        chat.isGroup && chat.name.toLowerCase() == name.toLowerCase()
      );
    });
    return group;
  }
  
  // Send message to group
  // You can use chatID or group name, yea!
  app.post('/send-group-message', [
    body('id').custom((value, { req }) => {
      if (!value && !req.body.name) {
        throw new Error('Invalid value, you can use `id` or `name`');
      }
      return true;
    }),
    body('message').notEmpty(),
  ], async (req, res) => {
    const errors = validationResult(req).formatWith(({
      msg
    }) => {
      return msg;
    });
  
    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped()
      });
    }
  
    let chatId = req.body.id;
    const groupName = req.body.name;
    const message = req.body.message;
  
    // Find the group by name
    if (!chatId) {
      const group = await findGroupByName(groupName);
      if (!group) {
        return res.status(422).json({
          status: false,
          message: 'No group found with name: ' + groupName
        });
      }
      chatId = group.id._serialized;
    }
  
    client.sendMessage(chatId, message).then(response => {
      res.status(200).json({
        status: true,
        response: response
      });
    }).catch(err => {
      res.status(500).json({
        status: false,
        response: err
      });
    });
  });
  
  // Clearing message on spesific chat
  app.post('/clear-message', [
    body('number').notEmpty(),
  ], async (req, res) => {
    const errors = validationResult(req).formatWith(({
      msg
    }) => {
      return msg;
    });
  
    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped()
      });
    }
  
    const number = phoneNumberFormatter(req.body.number);
  
    const isRegisteredNumber = await checkRegisteredNumber(number);
  
    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: 'The number is not registered'
      });
    }
  
    const chat = await client.getChatById(number);
    
    chat.clearMessages().then(status => {
      res.status(200).json({
        status: true,
        response: status
      });
    }).catch(err => {
      res.status(500).json({
        status: false,
        response: err
      });
    })
  });
  
  server.listen(port, function() {
    console.log('App running on *: ' + port);
  });
  

})();
