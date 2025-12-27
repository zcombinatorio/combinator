import dotenv from 'dotenv';

dotenv.config();

const KEY_SERVICE_URL = process.env.KEY_SERVICE_URL;
const KEY_IDX = process.env.KEY_IDX || '2';

(async () => {
  if (!KEY_SERVICE_URL) {
    console.error('KEY_SERVICE_URL environment variable is not set');
    process.exit(1);
  }
  if (!process.env.SIV_KEY) {
    console.error('SIV_KEY environment variable is not set');
    process.exit(1);
  }

  const response = await fetch(
    `${KEY_SERVICE_URL}?idx=${KEY_IDX}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${btoa(process.env.SIV_KEY)}`,
      },
    }
  );

  const data = await response.json();
  console.log(data);
})();