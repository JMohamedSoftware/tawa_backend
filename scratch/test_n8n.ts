
import axios from 'axios';

// Replace this with the URL you see in n8n (Production Webhook URL)
const N8N_WEBHOOK_URL = 'https://jbeli.app.n8n.cloud/webhook/artisan-approved';

async function sendTestTrigger() {
    console.log("📡 Sending test data to n8n...");
    try {
        const response = await axios.post(N8N_WEBHOOK_URL, {
            type: 'artisan_approved',
            name: 'محمد علي (حرفي تجريبي)',
            category: 'سباك (بلومبي)',
            bio: 'حرفي محترف مع 10 سنوات خبرة في تونس.',
            profileUrl: 'https://tawa.tn/artisan/test_id',
            imageUrl: 'https://tawa.tn/favicon.ico'
        });
        console.log("✅ Test successful! n8n responded with status:", response.status);
        console.log("Check your n8n dashboard now to see the notification!");
    } catch (err: any) {
        console.error("❌ Test failed:", err.response?.data || err.message);
    }
}

sendTestTrigger();
