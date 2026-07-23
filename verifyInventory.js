const fetch = globalThis.fetch;
const API = 'http://localhost:5001';
(async () => {
  try {
    const login = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@bharath.com', password: 'Admin@123' })
    });
    const data = await login.json();
    console.log('login', login.status, JSON.stringify(data));
    if (!data.token) return;
    const token = data.token;
    const headers = { 'Content-Type': 'application/json', Authorization: token };

    const addFoilRes = await fetch(`${API}/add-foil`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'blister', size: '100', weight: 5 })
    });
    const addFoilData = await addFoilRes.json().catch(() => null);
    console.log('add-foil', addFoilRes.status, JSON.stringify(addFoilData));

    const addCylinderRes = await fetch(`${API}/add-cylinder`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        product_name: 'Test Cylinder',
        colors: 4,
        size_inches: 10,
        manufacturer: 'TestCo',
        manufacture_date: '2026-07-16'
      })
    });
    const addCylinderData = await addCylinderRes.json().catch(() => null);
    console.log('add-cylinder', addCylinderRes.status, JSON.stringify(addCylinderData));

    const foils = await fetch(`${API}/foils`, { headers });
    console.log('foils', foils.status, await foils.text());

    const cylinders = await fetch(`${API}/cylinders`, { headers });
    console.log('cylinders', cylinders.status, await cylinders.text());

    const logs = await fetch(`${API}/stock-logs`, { headers });
    console.log('stock-logs', logs.status, await logs.text());

    if (addFoilData?.qrPayload || addFoilData?.foil?.qrPayload) {
      const qrPayload = addFoilData.qrPayload || addFoilData.foil?.qrPayload;
      const qrResp = await fetch(`${API}/qrs/foil/${encodeURIComponent(qrPayload)}/label`);
      console.log('qr route', qrResp.status, qrResp.headers.get('content-type'));
      const qrText = await qrResp.text();
      console.log('qr text length', qrText.length, qrText.slice(0, 120));
    }
  } catch (err) {
    console.error('ERROR', err);
  }
})();
