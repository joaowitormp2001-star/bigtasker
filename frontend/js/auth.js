// js/auth.js
import { api } from './api.js';

export async function login(email, senha) {
  try {
    const res = await api('/auth/login', 'POST', { email, senha });
    if (res.token) {
      localStorage.setItem('token', res.token);
      localStorage.setItem('usuario', JSON.stringify(res.usuario));
      return { sucesso: true };
    }
    return { sucesso: false, erro: res.mensagem || 'Credenciais inválidas' };
  } catch (err) {
    return { sucesso: false, erro: 'Erro de conexão com o servidor' };
  }
}

export async function cadastrar(nome, email, senha) {
  try {
    const res = await api('/auth/cadastro', 'POST', { nome, email, senha });
    if (res.token) {
      localStorage.setItem('token', res.token);
      localStorage.setItem('usuario', JSON.stringify(res.usuario));
      return { sucesso: true };
    }
    return { sucesso: false, erro: res.mensagem || 'Erro no cadastro' };
  } catch (err) {
    return { sucesso: false, erro: 'Erro de conexão com o servidor' };
  }
}

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
}

export function getUsuarioLogado() {
  const u = localStorage.getItem('usuario');
  return u ? JSON.parse(u) : null;
}

export function isAutenticado() {
  return !!localStorage.getItem('token');
}