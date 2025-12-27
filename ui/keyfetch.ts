import dotenv from 'dotenv';

dotenv.config();

(async () => {
  const response = await fetch(
    'https://web.hm.sivalik.com/personal/fapi/zc-key?idx=2',
    {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${btoa(process.env.SIV_KEY!)}`,
      },
    }
  );

  const data = await response.json();
  console.log(data);
})();

// logs:
// {
  // idx: 2,
  // keypair: '',
  // account: 'HHroB8P1q3kijtyML9WPvfTXG8JicfmUoGZjVzam64PX'
// }