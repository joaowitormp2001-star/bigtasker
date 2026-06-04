from flask import Flask, request, jsonify
from flask_jwt_extended import (
    JWTManager, create_access_token,
    jwt_required, get_jwt_identity
)
from flask_cors import CORS
from database.connection import criar_conexao
from dotenv import load_dotenv
import bcrypt
import os

load_dotenv()

app = Flask(__name__)
CORS(app)

app.config["JWT_SECRET_KEY"] = os.getenv("SECRET_KEY", "fallback-secret-key")
jwt = JWTManager(app)


# =========================
# UTILITÁRIOS DE PONTUAÇÃO
# =========================
def calcular_xp(dificuldade, score, consistente=False):
    """
    Tabela de pontuação:
      Fácil=8, Médio=20, Difícil=40 (xp_base)
      Score <50  → ×1.0
      Score 50-70→ ×1.2
      Score >70  → ×1.4
      Consistência (+7d sem atraso) → ×1.2 adicional
    """
    xp_base = {"facil": 8, "medio": 20, "dificil": 40}.get(dificuldade, 20)
    score = score or 60
    if score < 50:
        mod_score = 1.0
    elif score <= 70:
        mod_score = 1.2
    else:
        mod_score = 1.4
    mod_consistencia = 1.2 if consistente else 1.0
    return round(xp_base * mod_score * mod_consistencia, 1)


def verificar_consistencia(cursor, id_usuario):
    """
    Verifica se o usuário completou pelo menos 1 tarefa nos últimos 7 dias
    sem nenhuma tarefa atrasada no mesmo período.
    """
    cursor.execute(
        """
        SELECT COUNT(*) FROM tarefas
        WHERE id_usuario = %s
          AND status = 'concluida'
          AND data_conclusao >= NOW() - INTERVAL '7 days'
        """,
        (id_usuario,)
    )
    concluidas_7d = cursor.fetchone()[0]

    cursor.execute(
        """
        SELECT COUNT(*) FROM tarefas
        WHERE id_usuario = %s
          AND esta_atrasada = TRUE
          AND (data_criacao >= NOW() - INTERVAL '7 days'
               OR data_conclusao >= NOW() - INTERVAL '7 days')
        """,
        (id_usuario,)
    )
    atrasadas_7d = cursor.fetchone()[0]

    return concluidas_7d >= 1 and atrasadas_7d == 0


def atualizar_ranking(cursor, id_usuario, xp_ganho):
    """Mantida por compatibilidade — lógica migrada para dentro de concluir_tarefa."""
    pass


def verificar_e_conceder_conquistas(cursor, id_usuario):
    """
    Verifica e concede conquistas automaticamente para todos os tipos:
    tarefas, consistencia, social, score, ranking
    """
    # ── conquistas de tipo 'tarefas' ──
    cursor.execute(
        "SELECT COUNT(*) FROM tarefas WHERE id_usuario = %s AND status = 'concluida'",
        (id_usuario,)
    )
    total_concluidas = cursor.fetchone()[0]

    cursor.execute(
        """
        SELECT id, valor_necessario, xp_de_resgate
        FROM conquistas
        WHERE ativa = TRUE AND id_usuario = %s AND tipo = 'tarefas'
        """,
        (id_usuario,)
    )
    for c in cursor.fetchall():
        if total_concluidas >= c[1]:
            _conceder_conquista(cursor, id_usuario, c[0], c[2])

    # ── conquistas de tipo 'consistencia' ──
    cursor.execute(
        """
        SELECT COUNT(DISTINCT DATE(data_conclusao)) FROM tarefas
        WHERE id_usuario = %s AND status = 'concluida'
          AND esta_atrasada = FALSE
        """,
        (id_usuario,)
    )
    dias_consecutivos = cursor.fetchone()[0]

    cursor.execute(
        """
        SELECT id, valor_necessario, xp_de_resgate
        FROM conquistas
        WHERE ativa = TRUE AND id_usuario = %s AND tipo = 'consistencia'
        """,
        (id_usuario,)
    )
    for c in cursor.fetchall():
        if dias_consecutivos >= c[1]:
            _conceder_conquista(cursor, id_usuario, c[0], c[2])

    # ── conquistas de tipo 'social' ──
    cursor.execute(
        "SELECT COUNT(*) FROM postagens WHERE id_usuario = %s AND status = 'publicado'",
        (id_usuario,)
    )
    total_posts = cursor.fetchone()[0]

    cursor.execute(
        """
        SELECT id, valor_necessario, xp_de_resgate
        FROM conquistas
        WHERE ativa = TRUE AND id_usuario = %s AND tipo = 'social'
        """,
        (id_usuario,)
    )
    for c in cursor.fetchall():
        if total_posts >= c[1]:
            _conceder_conquista(cursor, id_usuario, c[0], c[2])

    # ── conquistas de tipo 'score' ──
    cursor.execute(
        "SELECT score FROM usuarios WHERE id = %s",
        (id_usuario,)
    )
    score_row = cursor.fetchone()
    score_atual = score_row[0] if score_row else 60

    cursor.execute(
        """
        SELECT id, valor_necessario, xp_de_resgate
        FROM conquistas
        WHERE ativa = TRUE AND id_usuario = %s AND tipo = 'score'
        """,
        (id_usuario,)
    )
    for c in cursor.fetchall():
        if score_atual >= c[1]:
            _conceder_conquista(cursor, id_usuario, c[0], c[2])

    # ── conquistas de tipo 'ranking' ──
    cursor.execute(
        """
        SELECT r.posicao FROM ranking r
        JOIN competicoes c ON r.id_competicao = c.id
        WHERE r.id_usuario = %s AND c.status = 'ativa'
        LIMIT 1
        """,
        (id_usuario,)
    )
    rank_row = cursor.fetchone()
    if rank_row:
        posicao_atual = rank_row[0]
        cursor.execute(
            """
            SELECT id, valor_necessario, xp_de_resgate
            FROM conquistas
            WHERE ativa = TRUE AND id_usuario = %s AND tipo = 'ranking'
            """,
            (id_usuario,)
        )
        for c in cursor.fetchall():
            # valor_necessario = posição máxima para conquistar (ex: 1 = top 1)
            if posicao_atual <= c[1]:
                _conceder_conquista(cursor, id_usuario, c[0], c[2])


def _conceder_conquista(cursor, id_usuario, id_conquista, xp_de_resgate):
    """Concede conquista se ainda não foi concedida, e registra XP bonus."""
    cursor.execute(
        "SELECT id FROM conquistas_usuarios WHERE id_usuario = %s AND id_conquista = %s",
        (id_usuario, id_conquista)
    )
    if cursor.fetchone():
        return  # já tem

    cursor.execute(
        """
        INSERT INTO conquistas_usuarios
            (id_usuario, id_conquista, data_desbloqueio)
        VALUES (%s, %s, NOW())
        """,
        (id_usuario, id_conquista)
    )

    if xp_de_resgate and xp_de_resgate > 0:
        cursor.execute(
            """
            INSERT INTO transacoes_xp
                (id_usuario, origem, quantia_xp, data_registro)
            VALUES (%s, 'conquista', %s, NOW())
            """,
            (id_usuario, xp_de_resgate)
        )
        cursor.execute(
            "UPDATE usuarios SET xp_total = xp_total + %s WHERE id = %s",
            (xp_de_resgate, id_usuario)
        )

    # Cria notificação
    cursor.execute(
        """
        SELECT nome FROM conquistas WHERE id = %s
        """,
        (id_conquista,)
    )
    nome_c = cursor.fetchone()
    if nome_c:
        cursor.execute(
            """
            INSERT INTO notificacoes
                (id_usuario, tipo, titulo, mensagem, tipo_relacao, id_relacao, data_notificacao)
            VALUES (%s, 'conquista', 'Conquista desbloqueada!', %s, 'conquista', %s, NOW())
            """,
            (id_usuario, f'Você desbloqueou: {nome_c[0]}', id_conquista)
        )


# =========================
# LOGIN
# =========================
@app.route("/auth/login", methods=["POST"])
def login():
    dados = request.get_json()
    if not dados:
        return jsonify({"mensagem": "Dados inválidos"}), 400

    email = dados.get("email", "").strip()
    senha = dados.get("senha", "")

    if not email or not senha:
        return jsonify({"mensagem": "Email e senha são obrigatórios"}), 400

    conexao = criar_conexao()
    cursor = conexao.cursor()
    cursor.execute(
        "SELECT id, id_nivel, nome, email, senha, score, xp_total, is_admin FROM usuarios WHERE email = %s",
        (email,)
    )
    usuario = cursor.fetchone()
    cursor.close()
    conexao.close()

    if not usuario:
        return jsonify({"mensagem": "Usuário não encontrado"}), 401

    if not bcrypt.checkpw(senha.encode("utf-8"), usuario[4].encode("utf-8")):
        return jsonify({"mensagem": "Senha incorreta"}), 401

    token = create_access_token(identity=str(usuario[0]))
    return jsonify({
        "token": token,
        "usuario": {
            "id":       usuario[0],
            "id_nivel": usuario[1],
            "nome":     usuario[2],
            "email":    usuario[3],
            "score":    usuario[5] if usuario[5] is not None else 60,
            "xp_total": usuario[6] if usuario[6] is not None else 0,
            "is_admin": usuario[7] if usuario[7] is not None else False,
        }
    }), 200


# =========================
# CADASTRO
# =========================
@app.route("/auth/cadastro", methods=["POST"])
def cadastro():
    dados = request.get_json()
    if not dados:
        return jsonify({"mensagem": "Dados inválidos"}), 400

    nome  = dados.get("nome", "").strip()
    email = dados.get("email", "").strip()
    senha = dados.get("senha", "")

    if not nome or not email or not senha:
        return jsonify({"mensagem": "Nome, email e senha são obrigatórios"}), 400

    senha_hash = bcrypt.hashpw(senha.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute("SELECT id FROM usuarios WHERE email = %s", (email,))
    if cursor.fetchone():
        cursor.close()
        conexao.close()
        return jsonify({"mensagem": "Email já cadastrado"}), 409

    try:
        cursor.execute(
            """
            INSERT INTO usuarios (id_nivel, nome, email, senha, score, xp_total)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (1, nome, email, senha_hash, 60, 0)
        )
        conexao.commit()

        cursor.execute(
            "SELECT id, id_nivel, nome, email, senha, score, xp_total, is_admin FROM usuarios WHERE email = %s",
            (email,)
        )
        usuario = cursor.fetchone()
        id_novo = usuario[0]

        # Cria conquistas padrão para o novo usuário
        conquistas_padrao = [
            # (tipo, nome, descricao, valor_necessario, xp_de_resgate, arte)
            ('tarefas',     'Primeiros Passos',       'Conclua sua primeira tarefa',         1,   50,  'primeiros-passos'),
            ('tarefas',     'Produtivo',              'Conclua 10 tarefas',                  10,  150, 'produtivo'),
            ('tarefas',     'Máquina de Tarefas',     'Conclua 50 tarefas',                  50,  500, 'maquina-de-tarefas'),
            ('tarefas',     'Centenário',             'Conclua 100 tarefas',                 100, 1000,'centenario'),
            ('consistencia','7 Dias Seguidos',        'Complete tarefas por 7 dias seguidos',7,   200, '7-dias-seguidos'),
            ('consistencia','Mês Consistente',        'Complete tarefas por 30 dias seguidos',30, 800, 'mes-consistente'),
            ('social',      'Primeiro Post',          'Publique sua primeira conquista',     1,   100, 'primeiro-post'),
            ('social',      'Influencer',             'Publique 10 conquistas',              10,  300, 'influencer'),
            ('score',       'Reputação Sólida',       'Alcance score ≥ 70',                  70,  200, 'reputacao-solida'),
            ('score',       'Elite',                  'Alcance score ≥ 90',                  90,  500, 'elite'),
            ('ranking',     'Top 3',                  'Fique entre os 3 primeiros do ranking', 3, 300, 'top-3'),
            ('ranking',     'Campeão',                'Fique em 1º lugar no ranking',        1,   1000,'campeao'),
        ]

        for tipo, nome_c, desc, val, xp_r, arte in conquistas_padrao:
            cursor.execute(
                """
                INSERT INTO conquistas
                    (id_usuario, tipo, nome, descricao_objetivo,
                     valor_necessario, xp_de_resgate, arte, ativa)
                VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE)
                ON CONFLICT DO NOTHING
                """,
                (id_novo, tipo, nome_c, desc, val, xp_r, arte)
            )

        # Insere no ranking da competição ativa (se houver)
        cursor.execute(
            "SELECT id FROM competicoes WHERE status = 'ativa' ORDER BY inicio DESC LIMIT 1"
        )
        comp = cursor.fetchone()
        if comp:
            cursor.execute(
                """
                INSERT INTO ranking
                    (id_usuario, id_competicao, xp_obtido, tarefas_concluidas,
                     participacao_ativa, posicao, data_atualizacao)
                VALUES (%s, %s, 0, 0, FALSE, NULL, NOW())
                ON CONFLICT DO NOTHING
                """,
                (id_novo, comp[0])
            )

        conexao.commit()
        token = create_access_token(identity=str(id_novo))

        return jsonify({
            "token": token,
            "usuario": {
                "id":       usuario[0],
                "id_nivel": usuario[1],
                "nome":     usuario[2],
                "email":    usuario[3],
                "score":    usuario[5] if usuario[5] is not None else 60,
                "xp_total": usuario[6] if usuario[6] is not None else 0,
                "is_admin": usuario[7] if usuario[7] is not None else False,
            }
        }), 201

    except Exception as e:
        conexao.rollback()
        return jsonify({"mensagem": f"Erro ao cadastrar: {str(e)}"}), 500

    finally:
        cursor.close()
        conexao.close()


# =========================
# PERFIL DO USUÁRIO LOGADO
# =========================
@app.route("/usuario/me", methods=["GET"])
@jwt_required()
def meu_perfil():
    id_usuario = int(get_jwt_identity())

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute(
        """
        SELECT
            u.id, u.nome, u.email, u.xp_total,
            u.score, n.nome AS nivel,
            u.foto, u.biografia,
            u.data_criacao, u.data_ultima_atualizacao
        FROM usuarios u
        JOIN niveis n ON u.id_nivel = n.id
        WHERE u.id = %s
        """,
        (id_usuario,)
    )
    u = cursor.fetchone()

    # XP semanal
    cursor.execute(
        """
        SELECT COALESCE(SUM(quantia_xp), 0)
        FROM transacoes_xp
        WHERE id_usuario = %s
          AND data_registro >= NOW() - INTERVAL '7 days'
        """,
        (id_usuario,)
    )
    xp_semanal = cursor.fetchone()[0]

    # Posição no ranking ativo
    cursor.execute(
        """
        SELECT r.posicao FROM ranking r
        JOIN competicoes c ON r.id_competicao = c.id
        WHERE r.id_usuario = %s AND c.status = 'ativa'
        LIMIT 1
        """,
        (id_usuario,)
    )
    rank_row = cursor.fetchone()

    cursor.close()
    conexao.close()

    if not u:
        return jsonify({"mensagem": "Usuário não encontrado"}), 404

    return jsonify({
        "id":              u[0],
        "nome":            u[1],
        "email":           u[2],
        "xp_total":        u[3],
        "score":           u[4],
        "nivel":           u[5],
        "foto":            u[6],
        "biografia":       u[7],
        "xp_semanal":      int(xp_semanal),
        "posicao_ranking": rank_row[0] if rank_row else None,
    }), 200


# =========================
# ATUALIZAR PERFIL
# =========================
@app.route("/usuario/me", methods=["PUT"])
@jwt_required()
def atualizar_perfil():
    id_usuario = int(get_jwt_identity())
    dados = request.get_json()

    campos = []
    valores = []

    if "nome" in dados:
        campos.append("nome = %s")
        valores.append(dados["nome"])
    if "biografia" in dados:
        campos.append("biografia = %s")
        valores.append(dados["biografia"])
    if "foto" in dados:
        campos.append("foto = %s")
        valores.append(dados["foto"])
    if "senha" in dados and len(dados["senha"]) >= 4:
        nova_hash = bcrypt.hashpw(dados["senha"].encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        campos.append("senha = %s")
        valores.append(nova_hash)

    if not campos:
        return jsonify({"mensagem": "Nenhum campo para atualizar"}), 400

    valores.append(id_usuario)
    conexao = criar_conexao()
    cursor  = conexao.cursor()
    cursor.execute(
        f"UPDATE usuarios SET {', '.join(campos)}, data_ultima_atualizacao = NOW() WHERE id = %s",
        tuple(valores)
    )
    conexao.commit()
    cursor.close()
    conexao.close()

    return jsonify({"mensagem": "Perfil atualizado"}), 200


# =========================
# LISTAR TAREFAS
# =========================
@app.route("/tarefas", methods=["GET"])
@jwt_required()
def listar_tarefas():
    id_usuario = int(get_jwt_identity())

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute(
        """
        UPDATE tarefas
        SET esta_atrasada = TRUE
        WHERE prazo < NOW()
          AND status != 'concluida'
          AND id_usuario = %s
        """,
        (id_usuario,)
    )
    conexao.commit()

    cursor.execute(
        """
        SELECT
            t.id, t.id_usuario, t.id_categoria,
            t.titulo, t.descricao, t.prazo,
            t.dificuldade, t.status,
            t.xp_base, t.xp_final,
            t.esta_atrasada, t.data_criacao,
            t.data_conclusao,
            c.nome AS categoria_nome,
            c.icone AS categoria_icone,
            (SELECT COUNT(*) FROM postagens p
             WHERE p.id_tarefa = t.id AND p.id_usuario = t.id_usuario
               AND p.status = 'publicado') > 0 AS tem_post
        FROM tarefas t
        LEFT JOIN categorias c ON t.id_categoria = c.id
        WHERE t.id_usuario = %s
        ORDER BY t.data_criacao DESC
        """,
        (id_usuario,)
    )
    tarefas = cursor.fetchall()
    cursor.close()
    conexao.close()

    return jsonify([{
        "id":              t[0],
        "id_usuario":      t[1],
        "id_categoria":    t[2],
        "titulo":          t[3],
        "descricao":       t[4],
        "prazo":           str(t[5]) if t[5] else None,
        "dificuldade":     t[6],
        "status":          t[7],
        "xp_base":         t[8],
        "xp_final":        float(t[9]) if t[9] else None,
        "esta_atrasada":   t[10],
        "data_criacao":    str(t[11]) if t[11] else None,
        "data_conclusao":  str(t[12]) if t[12] else None,
        "categoria_nome":  t[13],
        "categoria_icone": t[14],
        "tem_post":        t[15],
    } for t in tarefas]), 200


# =========================
# CRIAR TAREFA
# =========================
@app.route("/tarefas", methods=["POST"])
@jwt_required()
def criar_tarefa():
    id_usuario = int(get_jwt_identity())
    dados = request.get_json()

    titulo       = dados.get("titulo", "").strip()
    descricao    = dados.get("descricao", "")
    prazo        = dados.get("prazo")
    dificuldade  = dados.get("dificuldade", "medio")
    id_categoria = dados.get("id_categoria", 1)

    if not titulo:
        return jsonify({"mensagem": "Título é obrigatório"}), 400

    xp_map = {"facil": 8, "medio": 20, "dificil": 40}
    xp_base = xp_map.get(dificuldade, 20)

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    # Score atual do usuário para calcular xp_final estimado
    cursor.execute("SELECT score FROM usuarios WHERE id = %s", (id_usuario,))
    row = cursor.fetchone()
    score = row[0] if row else 60

    xp_estimado = calcular_xp(dificuldade, score)

    cursor.execute(
        """
        INSERT INTO tarefas
            (id_usuario, id_categoria, titulo, descricao,
             prazo, dificuldade, status, xp_base, xp_final, esta_atrasada)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            id_usuario, id_categoria, titulo, descricao,
            prazo, dificuldade, "pendente",
            xp_base, xp_estimado, False
        )
    )
    id_nova = cursor.fetchone()[0]
    conexao.commit()
    cursor.close()
    conexao.close()

    return jsonify({"mensagem": "Tarefa criada", "id": id_nova}), 201


# =========================
# EDITAR TAREFA
# =========================
@app.route("/tarefas/<int:id_tarefa>", methods=["PUT"])
@jwt_required()
def editar_tarefa(id_tarefa):
    id_usuario = int(get_jwt_identity())
    dados = request.get_json()

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute(
        "SELECT status FROM tarefas WHERE id = %s AND id_usuario = %s",
        (id_tarefa, id_usuario)
    )
    tarefa = cursor.fetchone()

    if not tarefa:
        cursor.close()
        conexao.close()
        return jsonify({"mensagem": "Tarefa não encontrada"}), 404

    if tarefa[0] == "concluida":
        cursor.close()
        conexao.close()
        return jsonify({"mensagem": "Tarefas concluídas não podem ser editadas"}), 400

    campos = []
    valores = []

    for campo in ["titulo", "descricao", "prazo", "dificuldade", "id_categoria", "status"]:
        if campo in dados:
            campos.append(f"{campo} = %s")
            valores.append(dados[campo])

    if not campos:
        cursor.close()
        conexao.close()
        return jsonify({"mensagem": "Nenhum campo para atualizar"}), 400

    # Se mudou dificuldade, recalcula xp_base e xp_final
    if "dificuldade" in dados:
        xp_map = {"facil": 8, "medio": 20, "dificil": 40}
        novo_xp_base = xp_map.get(dados["dificuldade"], 20)
        cursor.execute("SELECT score FROM usuarios WHERE id = %s", (id_usuario,))
        row = cursor.fetchone()
        score = row[0] if row else 60
        novo_xp_final = calcular_xp(dados["dificuldade"], score)
        campos.append("xp_base = %s")
        valores.append(novo_xp_base)
        campos.append("xp_final = %s")
        valores.append(novo_xp_final)

    # Se mudou prazo para o futuro, remove flag de atraso
    if "prazo" in dados and dados["prazo"]:
        campos.append("esta_atrasada = FALSE")

    valores.extend([id_tarefa, id_usuario])
    cursor.execute(
        f"""
        UPDATE tarefas
        SET {', '.join(campos)}, ultima_atualizacao = NOW()
        WHERE id = %s AND id_usuario = %s
        """,
        tuple(valores)
    )
    conexao.commit()
    cursor.close()
    conexao.close()

    return jsonify({"mensagem": "Tarefa atualizada"}), 200


# =========================
# EXCLUIR TAREFA
# =========================
@app.route("/tarefas/<int:id_tarefa>", methods=["DELETE"])
@jwt_required()
def excluir_tarefa(id_tarefa):
    id_usuario = int(get_jwt_identity())

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute(
        "DELETE FROM tarefas WHERE id = %s AND id_usuario = %s",
        (id_tarefa, id_usuario)
    )
    deletados = cursor.rowcount
    conexao.commit()
    cursor.close()
    conexao.close()

    if deletados == 0:
        return jsonify({"mensagem": "Tarefa não encontrada"}), 404

    return jsonify({"mensagem": "Tarefa excluída"}), 200


# =========================
# CONCLUIR TAREFA  ← núcleo do sistema de pontuação
# =========================
@app.route("/tarefas/<int:id_tarefa>/concluir", methods=["POST"])
@jwt_required()
def concluir_tarefa(id_tarefa):
    id_usuario = int(get_jwt_identity())

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute(
        """
        SELECT t.status, t.dificuldade, t.esta_atrasada, u.score
        FROM tarefas t
        JOIN usuarios u ON u.id = t.id_usuario
        WHERE t.id = %s AND t.id_usuario = %s
        """,
        (id_tarefa, id_usuario)
    )
    row = cursor.fetchone()

    if not row:
        cursor.close()
        conexao.close()
        return jsonify({"mensagem": "Tarefa não encontrada"}), 404

    if row[0] == "concluida":
        cursor.close()
        conexao.close()
        return jsonify({"mensagem": "Tarefa já concluída"}), 400

    status, dificuldade, esta_atrasada, score = row

    # Tarefa atrasada → 0 XP
    if esta_atrasada:
        xp_final = 0
    else:
        consistente = verificar_consistencia(cursor, id_usuario)
        xp_final = calcular_xp(dificuldade, score, consistente)

    # Conclui a tarefa
    cursor.execute(
        """
        UPDATE tarefas
        SET status = 'concluida', data_conclusao = NOW(), xp_final = %s
        WHERE id = %s
        """,
        (xp_final, id_tarefa)
    )

    if xp_final > 0:
        # Registra transação de XP
        cursor.execute(
            """
            INSERT INTO transacoes_xp
                (id_usuario, id_tarefa, origem, quantia_xp, data_registro)
            VALUES (%s, %s, 'tarefa', %s, NOW())
            """,
            (id_usuario, id_tarefa, xp_final)
        )

        # Atualiza XP do usuário
        cursor.execute(
            "UPDATE usuarios SET xp_total = xp_total + %s WHERE id = %s",
            (xp_final, id_usuario)
        )

        # Atualiza nível
        cursor.execute("SELECT xp_total FROM usuarios WHERE id = %s", (id_usuario,))
        xp_total = cursor.fetchone()[0]
        cursor.execute(
            "SELECT id FROM niveis WHERE %s BETWEEN xp_minimo AND xp_maximo",
            (xp_total,)
        )
        nivel = cursor.fetchone()
        if nivel:
            cursor.execute(
                "UPDATE usuarios SET id_nivel = %s WHERE id = %s",
                (nivel[0], id_usuario)
            )

        # Atualiza ranking — bloco isolado para não derrubar o XP se falhar
        try:
            cursor.execute(
                "SELECT id FROM competicoes WHERE status = 'ativa' ORDER BY inicio DESC LIMIT 1"
            )
            comp = cursor.fetchone()
            if comp:
                id_competicao = comp[0]
                cursor.execute(
                    "SELECT id, xp_obtido, tarefas_concluidas FROM ranking WHERE id_usuario = %s AND id_competicao = %s",
                    (id_usuario, id_competicao)
                )
                entry = cursor.fetchone()
                if entry:
                    cursor.execute(
                        """
                        UPDATE ranking
                        SET xp_obtido = %s,
                            tarefas_concluidas = %s,
                            participacao_ativa = TRUE
                        WHERE id = %s
                        """,
                        ((entry[1] or 0) + xp_final, (entry[2] or 0) + 1, entry[0])
                    )
                else:
                    cursor.execute(
                        """
                        INSERT INTO ranking
                            (id_usuario, id_competicao, xp_obtido, tarefas_concluidas, participacao_ativa)
                        VALUES (%s, %s, %s, 1, TRUE)
                        """,
                        (id_usuario, id_competicao, xp_final)
                    )
                # Recalcula posições
                cursor.execute(
                    """
                    UPDATE ranking r
                    SET posicao = sub.nova_pos
                    FROM (
                        SELECT id,
                               ROW_NUMBER() OVER (
                                   PARTITION BY id_competicao
                                   ORDER BY xp_obtido DESC, tarefas_concluidas DESC
                               ) AS nova_pos
                        FROM ranking
                        WHERE id_competicao = %s
                    ) sub
                    WHERE r.id = sub.id
                    """,
                    (id_competicao,)
                )
        except Exception as e_rank:
            print(f"Aviso: erro ao atualizar ranking (XP já salvo): {e_rank}")

    # Verifica conquistas
    verificar_e_conceder_conquistas(cursor, id_usuario)

    conexao.commit()

    cursor.execute(
        "SELECT xp_total, score FROM usuarios WHERE id = %s",
        (id_usuario,)
    )
    u_row = cursor.fetchone()
    xp_total_atual = u_row[0]
    score_atual    = u_row[1]

    cursor.execute(
        """
        SELECT COALESCE(SUM(quantia_xp), 0)
        FROM transacoes_xp
        WHERE id_usuario = %s AND data_registro >= NOW() - INTERVAL '7 days'
        """,
        (id_usuario,)
    )
    xp_semanal = cursor.fetchone()[0]

    cursor.close()
    conexao.close()

    return jsonify({
        "mensagem":   "Tarefa concluída",
        "xp_ganho":   xp_final,
        "xp_total":   float(xp_total_atual),
        "xp_semanal": int(xp_semanal),
        "score":      score_atual,
    }), 200


def verificar_consistencia_simples(xp_final):
    """Helper para retornar bool no response sem abrir nova conexão."""
    return xp_final > 0


# =========================
# LISTAR CATEGORIAS
# =========================
@app.route("/categorias", methods=["GET"])
@jwt_required()
def listar_categorias():
    conexao = criar_conexao()
    cursor  = conexao.cursor()
    cursor.execute("SELECT id, nome, icone, descricao FROM categorias ORDER BY nome")
    categorias = cursor.fetchall()
    cursor.close()
    conexao.close()

    return jsonify([{
        "id":        c[0],
        "nome":      c[1],
        "icone":     c[2],
        "descricao": c[3],
    } for c in categorias]), 200


# =========================
# RANKING
# =========================
@app.route("/ranking", methods=["GET"])
@jwt_required()
def ranking():
    id_usuario = int(get_jwt_identity())

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute(
        """
        SELECT id, nome, inicio, fim, status
        FROM competicoes
        WHERE status = 'ativa'
        ORDER BY inicio DESC
        LIMIT 1
        """
    )
    competicao = cursor.fetchone()

    if not competicao:
        cursor.close()
        conexao.close()
        return jsonify({"competicao": None, "ranking": []}), 200

    id_competicao = competicao[0]

    # Garante que o usuário atual está no ranking
    cursor.execute(
        "SELECT id FROM ranking WHERE id_usuario = %s AND id_competicao = %s",
        (id_usuario, id_competicao)
    )
    if not cursor.fetchone():
        cursor.execute(
            """
            INSERT INTO ranking
                (id_usuario, id_competicao, xp_obtido, tarefas_concluidas,
                 participacao_ativa, posicao, data_atualizacao)
            VALUES (%s, %s, 0, 0, FALSE, NULL, NOW())
            """,
            (id_usuario, id_competicao)
        )
        conexao.commit()

    # Recalcula posições antes de retornar
    cursor.execute(
        """
        UPDATE ranking r
        SET posicao = sub.nova_pos
        FROM (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY id_competicao
                       ORDER BY xp_obtido DESC, tarefas_concluidas DESC
                   ) AS nova_pos
            FROM ranking
            WHERE id_competicao = %s
        ) sub
        WHERE r.id = sub.id
        """,
        (id_competicao,)
    )
    conexao.commit()

    cursor.execute(
        """
        SELECT
            r.posicao,
            u.id,
            u.nome,
            u.foto,
            r.xp_obtido,
            r.tarefas_concluidas,
            r.participacao_ativa,
            n.nome AS nivel,
            u.score
        FROM ranking r
        JOIN usuarios u ON r.id_usuario = u.id
        JOIN niveis n ON u.id_nivel = n.id
        WHERE r.id_competicao = %s
        ORDER BY r.xp_obtido DESC, r.tarefas_concluidas DESC
        """,
        (id_competicao,)
    )
    rows = cursor.fetchall()

    cursor.close()
    conexao.close()

    return jsonify({
        "competicao": {
            "id":     competicao[0],
            "nome":   competicao[1],
            "inicio": str(competicao[2]),
            "fim":    str(competicao[3]),
            "status": competicao[4],
        },
        "ranking": [{
            "posicao":            r[0],
            "id_usuario":         r[1],
            "nome":               r[2],
            "foto":               r[3],
            "xp_obtido":          float(r[4]) if r[4] else 0,
            "tarefas_concluidas": r[5] or 0,
            "participacao_ativa": r[6],
            "nivel":              r[7],
            "score":              r[8] or 60,
        } for r in rows]
    }), 200


# =========================
# FEED - LISTAR POSTAGENS
# =========================
@app.route("/feed", methods=["GET"])
@jwt_required()
def listar_feed():
    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute(
        """
        SELECT
            p.id, p.id_usuario, p.id_tarefa,
            p.url_imagem, p.legenda, p.status,
            p.data_criacao,
            u.nome AS usuario_nome,
            u.foto AS usuario_foto,
            u.score AS usuario_score,
            t.titulo AS tarefa_titulo,
            t.dificuldade AS tarefa_dificuldade,
            t.xp_final AS tarefa_xp,
            c.nome AS categoria_nome,
            c.icone AS categoria_icone
        FROM postagens p
        JOIN usuarios u ON p.id_usuario = u.id
        JOIN tarefas t ON p.id_tarefa = t.id
        LEFT JOIN categorias c ON t.id_categoria = c.id
        WHERE p.status = 'publicado'
        ORDER BY p.data_criacao DESC
        LIMIT 50
        """
    )
    posts = cursor.fetchall()

    resultado = []
    for p in posts:
        cursor.execute(
            """
            SELECT tipo_reacao, COUNT(*) as total
            FROM reacoes_postagens
            WHERE id_post = %s
            GROUP BY tipo_reacao
            """,
            (p[0],)
        )
        reacoes_raw = cursor.fetchall()
        reacoes = {r[0]: r[1] for r in reacoes_raw}

        resultado.append({
            "id":              p[0],
            "id_usuario":      p[1],
            "id_tarefa":       p[2],
            "url_imagem":      p[3],
            "legenda":         p[4],
            "status":          p[5],
            "data_criacao":    str(p[6]) if p[6] else None,
            "usuario_nome":    p[7],
            "usuario_foto":    p[8],
            "usuario_score":   p[9],
            "tarefa_titulo":   p[10],
            "tarefa_dificuldade": p[11],
            "tarefa_xp":       float(p[12]) if p[12] else 0,
            "categoria_nome":  p[13],
            "categoria_icone": p[14],
            "reacoes": {
                "like":    reacoes.get("like", 0),
                "dislike": reacoes.get("dislike", 0),
                "coracao": reacoes.get("coracao", 0),
            }
        })

    cursor.close()
    conexao.close()
    return jsonify(resultado), 200


# =========================
# FEED - CRIAR POSTAGEM
# =========================
@app.route("/feed", methods=["POST"])
@jwt_required()
def criar_postagem():
    id_usuario = int(get_jwt_identity())
    dados = request.get_json()

    id_tarefa  = dados.get("id_tarefa")
    url_imagem = dados.get("url_imagem", "")
    legenda    = dados.get("legenda", "")

    if not id_tarefa:
        return jsonify({"mensagem": "id_tarefa é obrigatório"}), 400

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute(
        "SELECT status FROM tarefas WHERE id = %s AND id_usuario = %s",
        (id_tarefa, id_usuario)
    )
    tarefa = cursor.fetchone()

    if not tarefa:
        cursor.close()
        conexao.close()
        return jsonify({"mensagem": "Tarefa não encontrada"}), 404

    if tarefa[0] != "concluida":
        cursor.close()
        conexao.close()
        return jsonify({"mensagem": "Só é possível postar tarefas concluídas"}), 400

    cursor.execute(
        """
        INSERT INTO postagens
            (id_usuario, id_tarefa, url_imagem, legenda, status, data_criacao)
        VALUES (%s, %s, %s, %s, %s, NOW())
        RETURNING id
        """,
        (id_usuario, id_tarefa, url_imagem, legenda, "publicado")
    )
    id_post = cursor.fetchone()[0]

    # Verifica conquistas sociais após publicar
    verificar_e_conceder_conquistas(cursor, id_usuario)

    conexao.commit()
    cursor.close()
    conexao.close()

    return jsonify({"mensagem": "Postagem criada", "id": id_post}), 201


# =========================
# FEED - REAGIR A POST
# =========================
@app.route("/feed/<int:id_post>/reagir", methods=["POST"])
@jwt_required()
def reagir_post(id_post):
    id_usuario = int(get_jwt_identity())
    dados = request.get_json()
    tipo = dados.get("tipo")

    if tipo not in ["like", "dislike", "coracao"]:
        return jsonify({"mensagem": "Tipo inválido"}), 400

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute(
        "DELETE FROM reacoes_postagens WHERE id_post = %s AND id_usuario = %s",
        (id_post, id_usuario)
    )

    cursor.execute(
        "SELECT id_usuario FROM postagens WHERE id = %s",
        (id_post,)
    )
    post = cursor.fetchone()

    if not post:
        cursor.close()
        conexao.close()
        return jsonify({"mensagem": "Post não encontrado"}), 404

    id_dono = post[0]

    cursor.execute(
        """
        INSERT INTO reacoes_postagens
            (id_post, id_usuario, tipo_reacao, data_reacao)
        VALUES (%s, %s, %s, NOW())
        """,
        (id_post, id_usuario, tipo)
    )

    delta_score = {"like": 0.2, "dislike": -0.2, "coracao": 0.5}.get(tipo, 0)
    if delta_score != 0 and id_dono != id_usuario:
        cursor.execute(
            """
            UPDATE usuarios
            SET score = GREATEST(0, LEAST(100, score + %s))
            WHERE id = %s
            """,
            (delta_score, id_dono)
        )
        cursor.execute(
            """
            INSERT INTO score_reputacao
                (id_usuario, origem, id_origem, alteracao_score,
                 score_anterior, novo_score, data_alteracao)
            SELECT
                %s, 'reacao', %s, %s,
                score - %s, score, NOW()
            FROM usuarios WHERE id = %s
            """,
            (id_dono, id_post, delta_score, delta_score, id_dono)
        )
        # Conquistas de score do dono
        verificar_e_conceder_conquistas(cursor, id_dono)

    conexao.commit()
    cursor.close()
    conexao.close()

    return jsonify({"mensagem": "Reação registrada"}), 200


# =========================
# CONQUISTAS DO USUÁRIO
# =========================
@app.route("/conquistas", methods=["GET"])
@jwt_required()
def listar_conquistas():
    id_usuario = int(get_jwt_identity())

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    # Garante que o usuário tem conquistas criadas
    cursor.execute(
        "SELECT COUNT(*) FROM conquistas WHERE id_usuario = %s AND ativa = TRUE",
        (id_usuario,)
    )
    total = cursor.fetchone()[0]

    if total == 0:
        # Cria conquistas padrão retroativamente
        conquistas_padrao = [
            ('tarefas',     'Primeiros Passos',       'Conclua sua primeira tarefa',          1,   50,  'primeiros-passos'),
            ('tarefas',     'Produtivo',              'Conclua 10 tarefas',                   10,  150, 'produtivo'),
            ('tarefas',     'Máquina de Tarefas',     'Conclua 50 tarefas',                   50,  500, 'maquina-de-tarefas'),
            ('tarefas',     'Centenário',             'Conclua 100 tarefas',                  100, 1000,'centenario'),
            ('consistencia','7 Dias Seguidos',        'Complete tarefas por 7 dias seguidos', 7,   200, '7-dias-seguidos'),
            ('consistencia','Mês Consistente',        'Complete tarefas por 30 dias seguidos',30,  800, 'mes-consistente'),
            ('social',      'Primeiro Post',          'Publique sua primeira conquista',      1,   100, 'primeiro-post'),
            ('social',      'Influencer',             'Publique 10 conquistas',               10,  300, 'influencer'),
            ('score',       'Reputação Sólida',       'Alcance score ≥ 70',                   70,  200, 'reputacao-solida'),
            ('score',       'Elite',                  'Alcance score ≥ 90',                   90,  500, 'elite'),
            ('ranking',     'Top 3',                  'Fique entre os 3 primeiros do ranking',3,   300, 'top-3'),
            ('ranking',     'Campeão',                'Fique em 1º lugar no ranking',         1,   1000,'campeao'),
        ]
        for tipo, nome_c, desc, val, xp_r, arte in conquistas_padrao:
            cursor.execute(
                """
                INSERT INTO conquistas
                    (id_usuario, tipo, nome, descricao_objetivo,
                     valor_necessario, xp_de_resgate, arte, ativa)
                VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE)
                ON CONFLICT DO NOTHING
                """,
                (id_usuario, tipo, nome_c, desc, val, xp_r, arte)
            )
        conexao.commit()

    cursor.execute(
        """
        SELECT id, tipo, nome, descricao_objetivo,
               valor_necessario, xp_de_resgate, arte
        FROM conquistas
        WHERE ativa = TRUE AND id_usuario = %s
        ORDER BY tipo, valor_necessario
        """,
        (id_usuario,)
    )
    todas = cursor.fetchall()

    cursor.execute(
        "SELECT id_conquista FROM conquistas_usuarios WHERE id_usuario = %s",
        (id_usuario,)
    )
    desbloqueadas_ids = {row[0] for row in cursor.fetchall()}

    cursor.close()
    conexao.close()

    return jsonify([{
        "id":               c[0],
        "tipo":             c[1],
        "nome":             c[2],
        "descricao":        c[3],
        "valor_necessario": c[4],
        "xp_de_resgate":    c[5],
        "arte":             c[6],
        "desbloqueada":     c[0] in desbloqueadas_ids,
    } for c in todas]), 200


# =========================
# NOTIFICAÇÕES
# =========================
@app.route("/notificacoes", methods=["GET"])
@jwt_required()
def listar_notificacoes():
    id_usuario = int(get_jwt_identity())

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute(
        """
        SELECT id, tipo, titulo, mensagem, tipo_relacao,
               id_relacao, data_notificacao
        FROM notificacoes
        WHERE id_usuario = %s
        ORDER BY data_notificacao DESC
        LIMIT 20
        """,
        (id_usuario,)
    )
    notifs = cursor.fetchall()
    cursor.close()
    conexao.close()

    return jsonify([{
        "id":               n[0],
        "tipo":             n[1],
        "titulo":           n[2],
        "mensagem":         n[3],
        "tipo_relacao":     n[4],
        "id_relacao":       n[5],
        "data_notificacao": str(n[6]) if n[6] else None,
    } for n in notifs]), 200


# =========================
# PAINEL ADM - ALERTAS ANTI-FRAUDE
# =========================
@app.route("/admin/alertas", methods=["GET"])
@jwt_required()
def listar_alertas():
    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute(
        """
        SELECT
            a.id, a.id_usuario, a.quantia_tarefas_suspeitas,
            a.intervalo_total, a.status, a.data_alerta,
            u.nome AS usuario_nome
        FROM alerta_anti_fraudes a
        JOIN usuarios u ON a.id_usuario = u.id
        WHERE a.status = 'pendente'
        ORDER BY a.data_alerta DESC
        """
    )
    alertas = cursor.fetchall()
    cursor.close()
    conexao.close()

    return jsonify([{
        "id":                       al[0],
        "id_usuario":               al[1],
        "quantia_tarefas_suspeitas": al[2],
        "intervalo_total":          str(al[3]) if al[3] else None,
        "status":                   al[4],
        "data_alerta":              str(al[5]) if al[5] else None,
        "usuario_nome":             al[6],
    } for al in alertas]), 200


@app.route("/admin/alertas/<int:id_alerta>/descartar", methods=["POST"])
@jwt_required()
def descartar_alerta(id_alerta):
    conexao = criar_conexao()
    cursor  = conexao.cursor()
    cursor.execute(
        "UPDATE alerta_anti_fraudes SET status = 'descartado' WHERE id = %s",
        (id_alerta,)
    )
    conexao.commit()
    cursor.close()
    conexao.close()
    return jsonify({"mensagem": "Alerta descartado"}), 200


@app.route("/admin/alertas/<int:id_alerta>/penalizar", methods=["POST"])
@jwt_required()
def penalizar_usuario_alerta(id_alerta):
    dados = request.get_json()
    id_usuario_alvo = dados.get("id_usuario")
    motivo = dados.get("motivo", "Fraude detectada")

    if not id_usuario_alvo:
        return jsonify({"mensagem": "id_usuario é obrigatório"}), 400

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    # Penaliza: zera score, remove 20% do XP
    cursor.execute(
        """
        UPDATE usuarios
        SET score = GREATEST(0, score - 30),
            xp_total = GREATEST(0, xp_total - FLOOR(xp_total * 0.2))
        WHERE id = %s
        """,
        (id_usuario_alvo,)
    )

    cursor.execute(
        "UPDATE alerta_anti_fraudes SET status = 'resolvido' WHERE id = %s",
        (id_alerta,)
    )

    cursor.execute(
        """
        INSERT INTO notificacoes
            (id_usuario, tipo, titulo, mensagem, data_notificacao)
        VALUES (%s, 'penalidade', 'Penalidade aplicada', %s, NOW())
        """,
        (id_usuario_alvo, motivo)
    )

    conexao.commit()
    cursor.close()
    conexao.close()

    return jsonify({"mensagem": "Penalidade aplicada"}), 200


# =========================
# PAINEL ADM - MÉTRICAS
# =========================
@app.route("/admin/metricas", methods=["GET"])
@jwt_required()
def metricas():
    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute("SELECT COUNT(*) FROM usuarios")
    total_usuarios = cursor.fetchone()[0]

    cursor.execute(
        "SELECT COUNT(*) FROM usuarios WHERE DATE(data_criacao) = CURRENT_DATE"
    )
    novos_hoje = cursor.fetchone()[0]

    cursor.execute(
        "SELECT COUNT(*) FROM alerta_anti_fraudes WHERE status = 'pendente'"
    )
    pendencias = cursor.fetchone()[0]

    cursor.close()
    conexao.close()

    return jsonify({
        "usuarios_ativos": total_usuarios,
        "novos_hoje":      novos_hoje,
        "pendencias":      pendencias,
    }), 200


# =========================
# XP SEMANAL (endpoint dedicado)
# =========================
@app.route("/usuario/xp-semanal", methods=["GET"])
@jwt_required()
def xp_semanal():
    id_usuario = int(get_jwt_identity())

    conexao = criar_conexao()
    cursor  = conexao.cursor()

    cursor.execute(
        """
        SELECT COALESCE(SUM(quantia_xp), 0)
        FROM transacoes_xp
        WHERE id_usuario = %s
          AND data_registro >= NOW() - INTERVAL '7 days'
        """,
        (id_usuario,)
    )
    xp = cursor.fetchone()[0]
    cursor.close()
    conexao.close()

    return jsonify({"xp_semanal": int(xp)}), 200


# =========================
# TESTE BANCO
# =========================
@app.route("/teste_db")
def teste_db():
    try:
        conexao = criar_conexao()
        cursor  = conexao.cursor()
        cursor.execute("SELECT COUNT(*) FROM usuarios")
        total = cursor.fetchone()[0]
        cursor.close()
        conexao.close()
        return jsonify({"status": "ok", "total_usuarios": total}), 200
    except Exception as e:
        return jsonify({"status": "erro", "detalhe": str(e)}), 500


# =========================
# INICIALIZAÇÃO
# =========================
if __name__ == "__main__":
    app.run(debug=True)
