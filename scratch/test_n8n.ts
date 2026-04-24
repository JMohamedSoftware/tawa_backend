import axios from 'axios';

async function testHook() {
  try {
    const res = await axios.post('https://jbeli.app.n8n.cloud/webhook/artisan-approved', {
      type: 'test_after_fix',
      name: 'Artisan Mohamed',
      phone: '216 22 333 444',
      category: 'نجارة'
    });
    console.log("Success! n8n response:", res.data);
  } catch (err) {
    console.error("Failed to hit n8n:", (err as any).message);
  }
}

testHook();
