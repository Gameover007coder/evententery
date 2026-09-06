const fs = require('fs');
const path = require('path');
const net = require('net');
const mongoose = require('mongoose');

const dataDir = path.join(__dirname, '..', 'data');
const jsonFilePath = path.join(dataDir, 'visitors.json');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let isUsingMongoose = false;
let MongooseVisitorModel = null;

// JSON File Database Store
class JsonStore {
  static read() {
    try {
      if (!fs.existsSync(jsonFilePath)) {
        fs.writeFileSync(jsonFilePath, JSON.stringify([], null, 2));
        return [];
      }
      const raw = fs.readFileSync(jsonFilePath, 'utf8');
      return JSON.parse(raw || '[]');
    } catch (err) {
      console.error('Error reading JSON DB:', err.message);
      return [];
    }
  }

  static write(data) {
    try {
      fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Error writing to JSON DB:', err.message);
    }
  }

  static find(query = {}) {
    let list = JsonStore.read();
    let filtered = list.filter((item) => {
      for (const [key, val] of Object.entries(query)) {
        if (item[key] !== val) return false;
      }
      return true;
    });

    return {
      sort(sortCriteria = {}) {
        const [field, dir] = Object.entries(sortCriteria)[0] || ['createdAt', -1];
        filtered.sort((a, b) => {
          const valA = a[field];
          const valB = b[field];
          if (valA < valB) return dir === -1 ? 1 : -1;
          if (valA > valB) return dir === -1 ? -1 : 1;
          return 0;
        });
        return Promise.resolve(filtered);
      },
      then(resolve, reject) {
        return Promise.resolve(filtered).then(resolve, reject);
      },
      catch(reject) {
        return Promise.resolve(filtered).catch(reject);
      },
    };
  }

  static async findOne(query = {}) {
    const list = JsonStore.read();
    const item = list.find((record) => {
      for (const [key, val] of Object.entries(query)) {
        if (record[key] !== val) return false;
      }
      return true;
    });
    return item ? { ...item } : null;
  }

  static async create(doc) {
    const list = JsonStore.read();
    const newDoc = {
      _id: 'v_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      name: doc.name,
      email: (doc.email || '').toLowerCase().trim(),
      phone: doc.phone || '',
      qrToken: doc.qrToken,
      status: doc.status || 'pending',
      checkedInAt: doc.checkedInAt || null,
      checkedInBy: doc.checkedInBy || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    list.push(newDoc);
    JsonStore.write(list);
    return newDoc;
  }

  static async findOneAndUpdate(query, update, options = {}) {
    const list = JsonStore.read();
    const index = list.findIndex((record) => {
      for (const [key, val] of Object.entries(query)) {
        if (record[key] !== val) return false;
      }
      return true;
    });

    if (index === -1) return null;

    const original = list[index];
    const updated = { ...original };

    if (update.$set) {
      Object.assign(updated, update.$set);
    } else {
      for (const [key, val] of Object.entries(update)) {
        if (!key.startsWith('$')) {
          updated[key] = val;
        }
      }
    }
    updated.updatedAt = new Date().toISOString();
    list[index] = updated;
    JsonStore.write(list);
    return options.new ? updated : original;
  }

  static async deleteOne(query) {
    const list = JsonStore.read();
    const index = list.findIndex((record) => {
      for (const [key, val] of Object.entries(query)) {
        if (record[key] !== val) return false;
      }
      return true;
    });
    if (index !== -1) {
      list.splice(index, 1);
      JsonStore.write(list);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }

  static async countDocuments(query = {}) {
    const res = await JsonStore.find(query);
    return res.length;
  }
}

// Fast probe if a local port is actively open
function checkPortOpen(host, port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = false;

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      status = true;
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

// Initialize database connection
async function initDb() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.log('⚡ No MONGO_URI provided. Using local JSON database (data/visitors.json).');
    return false;
  }

  // If local mongodb URI, probe port first to avoid long Mongoose hangs
  if (uri.includes('localhost') || uri.includes('127.0.0.1')) {
    const isOpen = await checkPortOpen('127.0.0.1', 27017, 300);
    if (!isOpen) {
      console.log('ℹ️  Local MongoDB is not running on port 27017.');
      console.log('⚡ Auto-fallback: Using local JSON database (data/visitors.json).');
      isUsingMongoose = false;
      return false;
    }
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 2000,
    });
    console.log('✅ Connected to MongoDB via Mongoose.');
    isUsingMongoose = true;

    const visitorSchema = new mongoose.Schema(
      {
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, trim: true, lowercase: true },
        phone: { type: String, trim: true },
        qrToken: { type: String, required: true, unique: true, index: true },
        status: { type: String, enum: ['pending', 'checked_in'], default: 'pending' },
        checkedInAt: { type: Date, default: null },
        checkedInBy: { type: String, default: null },
      },
      { timestamps: true }
    );
    MongooseVisitorModel = mongoose.model('Visitor', visitorSchema);
    return true;
  } catch (err) {
    console.log('ℹ️  Could not connect to MongoDB (' + err.message + ').');
    console.log('⚡ Auto-fallback: Using local JSON database (data/visitors.json).');
    try { await mongoose.disconnect(); } catch (e) {}
    isUsingMongoose = false;
    return false;
  }
}

// Proxy wrapper for Visitor model that routes to Mongoose or JsonStore
const VisitorProxy = {
  find(query) {
    return isUsingMongoose && MongooseVisitorModel
      ? MongooseVisitorModel.find(query)
      : JsonStore.find(query);
  },
  findOne(query) {
    return isUsingMongoose && MongooseVisitorModel
      ? MongooseVisitorModel.findOne(query)
      : JsonStore.findOne(query);
  },
  create(doc) {
    return isUsingMongoose && MongooseVisitorModel
      ? MongooseVisitorModel.create(doc)
      : JsonStore.create(doc);
  },
  findOneAndUpdate(query, update, options) {
    return isUsingMongoose && MongooseVisitorModel
      ? MongooseVisitorModel.findOneAndUpdate(query, update, options)
      : JsonStore.findOneAndUpdate(query, update, options);
  },
  deleteOne(query) {
    return isUsingMongoose && MongooseVisitorModel
      ? MongooseVisitorModel.deleteOne(query)
      : JsonStore.deleteOne(query);
  },
  countDocuments(query) {
    return isUsingMongoose && MongooseVisitorModel
      ? MongooseVisitorModel.countDocuments(query)
      : JsonStore.countDocuments(query);
  },
};

module.exports = {
  initDb,
  Visitor: VisitorProxy,
};
