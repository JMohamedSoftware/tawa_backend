
import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

async function simulateBruteForce() {
    console.log("🚀 Starting Brute Force Simulation on /api/auth/login...");
    console.log("Current Limit: 10 attempts per hour.");

    for (let i = 1; i <= 15; i++) {
        try {
            const res = await axios.post(`${BASE_URL}/api/auth/login`, {
                email: 'test@example.com',
                password: 'wrongpassword'
            });
            console.log(`Attempt ${i}: Status ${res.status}`);
        } catch (err: any) {
            if (err.response?.status === 429) {
                console.log(`❌ Attempt ${i}: BLOCKED (Status 429 - Too Many Requests)`);
                console.log("✅ Security Test Passed: Rate Limiter is working!");
                return;
            }
            console.log(`Attempt ${i}: Error ${err.response?.status}`);
        }
    }
}

simulateBruteForce();
