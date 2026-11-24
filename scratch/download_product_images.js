import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEST_DIR = path.resolve(__dirname, '../frontend/public/products');

if (!fs.existsSync(DEST_DIR)) {
  fs.mkdirSync(DEST_DIR, { recursive: true });
}

// 10 realistic food photograph sources for Indian traditional snacks
const IMAGES = [
  {
    filename: 'murukku.jpg',
    url: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80', // Crisp golden Indian snack
  },
  {
    filename: 'potato-chips.jpg',
    url: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=600&q=80', // Golden salted potato chips
  },
  {
    filename: 'banana-chips.jpg',
    url: 'https://images.unsplash.com/photo-1621996346565-e3d5d62817d2?auto=format&fit=crop&w=600&q=80', // Golden yellow banana chips
  },
  {
    filename: 'mixture.jpg',
    url: 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=600&q=80', // Traditional spicy Indian snack mixture
  },
  {
    filename: 'ribbon-pakoda.jpg',
    url: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=600&q=80', // Golden savory ribbon snacks
  },
  {
    filename: 'thattai.jpg',
    url: 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?auto=format&fit=crop&w=600&q=80', // Crispy crackers / thattai
  },
  {
    filename: 'masala-chips.jpg',
    url: 'https://images.unsplash.com/photo-1527842891421-42eec6e703ea?auto=format&fit=crop&w=600&q=80', // Chili spiced potato crisps
  },
  {
    filename: 'kara-boondi.jpg',
    url: 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?auto=format&fit=crop&w=600&q=80', // Crispy fried spiced boondi
  },
  {
    filename: 'tapioca-chips.jpg',
    url: 'https://images.unsplash.com/photo-1596797038530-2c107229654b?auto=format&fit=crop&w=600&q=80', // Crunchy cassava wafers
  },
  {
    filename: 'seedai.jpg',
    url: 'https://images.unsplash.com/photo-1505253758473-96b3d5eb4e41?auto=format&fit=crop&w=600&q=80', // Roasted round snacks
  },
];

async function downloadImages() {
  console.log('Downloading realistic food product photographs into frontend/public/products...');
  for (const item of IMAGES) {
    const dest = path.join(DEST_DIR, item.filename);
    try {
      const res = await fetch(item.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        fs.writeFileSync(dest, Buffer.from(buffer));
        console.log(`✓ Saved ${item.filename} (${buffer.byteLength} bytes)`);
      } else {
        console.warn(`! HTTP ${res.status} for ${item.filename}`);
      }
    } catch (err) {
      console.warn(`! Failed to fetch ${item.filename}: ${err.message}`);
    }
  }
}

downloadImages();
