const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const User = require('./models/User.js');
const Place = require('./models/Place.js');
const Booking = require('./models/Booking.js');
const imageDownloader = require('image-downloader');
const fs = require('fs');
const multer = require('multer');

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;
const bcryptSalt = bcrypt.genSaltSync(10);
const jwtSecret = process.env.JWT_SECRET || 'defaultSecret';

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(__dirname + '/uploads'));
app.use(cors({
  credentials: true,
  origin: 'http://localhost:5173',
}));

// Database Connection
mongoose.connect(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

function getUserDataFromReq(req) {
  return new Promise((resolve, reject) => {
    jwt.verify(req.cookies.token, jwtSecret, {}, async (err, userData) => {
      if (err) throw err;
      resolve(userData);
    })
  });
}

// Routes
app.get('/', (req, res) => {
  res.json('Test Ok!');
});

app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  const hashedPassword = bcrypt.hashSync(password, bcryptSalt);
  try {
    const userDoc = await User.create({
      name,
      email,
      password: hashedPassword,
    });
    res.json(userDoc);
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/login', async (req, res) => {
  mongoose.connect(process.env.MONGO_URL);
  const { email, password } = req.body;
  const userDoc = await User.findOne({ email });
  if (userDoc) {
    const passOk = bcrypt.compareSync(password, userDoc.password);
    if (passOk) {
      jwt.sign({
        email: userDoc.email,
        id: userDoc._id
      }, jwtSecret, {}, (err, token) => {
        if (err) throw err;
        res.cookie('token', token).json(userDoc);
      });
    } else {
      res.status(422).json('Password not correct');
    }
  } else {
    res.status(404).json('User not found');
  }
});

app.get('/profile', (req, res) => {
  mongoose.connect(process.env.MONGO_URL);
  const { token } = req.cookies;
  if (token) {
    jwt.verify(token, jwtSecret, {}, async (err, userData) => {
      if (err) throw err;
      const { name, email, _id } = await User.findById(userData.id);
      res.json({ name, email, _id });
    });
  } else {
    res.json(null);
  }
});

app.post('/logout', (req, res) => {
  res.cookie('token', '').json(true);
})

// Image upload by link
app.post('/upload-by-link', async (req, res) => {
  const { link } = req.body;

  if (!link) {
    return res.status(400).json({ error: 'Link is required' });
  }

  console.log('Received link:', link);

  const newName = 'photo' + Date.now() + '.jpg';

  try {
    await imageDownloader.image({
      url: link,
      dest: __dirname + '/uploads/' + newName,
    });
    console.log('Uploaded by link:', newName);
    res.json(newName);
  } catch (error) {
    console.error('Error downloading the image:', error);
    res.status(500).json({ error: 'Error downloading the image' });
  }
});

// Multer setup for file uploads
const upload = multer({ dest: 'uploads/' });

// File upload from device
app.post('/upload', upload.array('photos', 100), (req, res) => {
  const uploadedFiles = [];
  for (let i = 0; i < req.files.length; i++) {
    const { path, originalname } = req.files[i];
    const parts = originalname.split('.');
    const ext = parts[parts.length - 1];
    const newPath = path + '.' + ext;
    fs.renameSync(path, newPath);
    uploadedFiles.push(newPath.replace('uploads/', ''));
  }
  console.log('Uploaded files:', uploadedFiles);
  res.json(uploadedFiles);
})

app.post('/places', (req, res) => {
  const { token } = req.cookies;
  const { title, address, photos, description, perks, extraInfo, checkIn, checkOut, maxGuests, price } = req.body;
  jwt.verify(token, jwtSecret, {}, async (err, userData) => {
    if (err) throw err;
    const placeDoc = await Place.create({
      owner: userData.id,
      title, address, photos, description,
      perks, extraInfo, checkIn, checkOut,
      maxGuests, price,
    });
    res.json(placeDoc);
  });
})

app.get('/user-places', (req, res) => {
  const { token } = req.cookies;
  jwt.verify(token, jwtSecret, {}, async (err, userData) => {
    const { id } = userData;
    res.json(await Place.find({ owner: id }))
  })
})
app.get('/places/:id', async (req, res) => {
  const { id } = req.params;
  res.json(await Place.findById(id));
})

app.put('/places', async (req, res) => {
  const { token } = req.cookies;
  const { id, title, address, photos, description, perks, extraInfo, checkIn, checkOut, maxGuests, price } = req.body;
  jwt.verify(token, jwtSecret, {}, async (err, userData) => {
    if (err) throw err;
    const placeDoc = await Place.findById(id);
    if (userData.id === placeDoc.owner.toString()) {
      placeDoc.set({
        title, address, photos, description,
        perks, extraInfo, checkIn, checkOut,
        maxGuests, price,
      })
      await placeDoc.save();
      res.json('ok');
    }
  });
})

app.get('/places', async (req, res) => {
  res.json(await Place.find());
})

app.post('/bookings', async (req, res) => {
  const userData = await getUserDataFromReq(req);
  const { place, checkIn, checkOut, numberOfGuests, name, phone, price } = req.body;
  Booking.create({
    place, checkIn, checkOut,
    numberOfGuests, name, phone, price,
    user: userData.id,
  }).then((doc) => {
    res.json(doc);
  }).catch((err) => {
    throw err;
  })
})

app.get('/bookings', async (req, res) => {
  const userData = await getUserDataFromReq(req);
  res.json(await Booking.find({ user: userData.id }).populate('place'))
})

// Start Server
const server = app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

// Graceful Shutdown
process.on('SIGINT', () => {
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});
