const API_URL = 'https://bigtasker-backend.onrender.com';

async function api(rota, metodo = 'GET', corpo = null) {
  const config = {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
    }
  };
  if (corpo) config.body = JSON.stringify(corpo);
  
  const res = await fetch(API_URL + rota, config);
  return res.json();
}

// Exemplos de uso nos outros arquivos:
// const tarefas = await api('/tarefas');
// const login = await api('/auth/login', 'POST', { email, senha });