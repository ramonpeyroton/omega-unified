# -*- coding: utf-8 -*-
"""
Gera um PDF imprimível com TODOS os questionários de visita da Omega.
Fonte da verdade: src/apps/sales/data/questionnaire.js (estado atual).
Saída: C:\\Users\\ramon\\Documents\\Questionarios-Omega.pdf
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, HRFlowable
)
from reportlab.lib.enums import TA_LEFT
from datetime import date

ORANGE = colors.HexColor("#E8732A")
CHARCOAL = colors.HexColor("#2C2C2A")
SLATE = colors.HexColor("#5b5b57")
LIGHT = colors.HexColor("#f3f1ee")
GREYLINE = colors.HexColor("#d8d5d0")

styles = getSampleStyleSheet()

title_style = ParagraphStyle("TitleX", parent=styles["Title"], textColor=CHARCOAL, fontSize=24, leading=28, spaceAfter=6)
sub_style = ParagraphStyle("SubX", parent=styles["Normal"], textColor=SLATE, fontSize=11, leading=15)
service_style = ParagraphStyle("Service", parent=styles["Heading1"], textColor=colors.white, fontSize=16, leading=20,
                               backColor=ORANGE, borderPadding=(6, 8, 6, 8), spaceBefore=4, spaceAfter=10)
section_style = ParagraphStyle("Section", parent=styles["Heading2"], textColor=ORANGE, fontSize=12.5, leading=16,
                               spaceBefore=12, spaceAfter=4)
q_style = ParagraphStyle("Q", parent=styles["Normal"], textColor=CHARCOAL, fontSize=10.5, leading=14, spaceBefore=4)
meta_style = ParagraphStyle("Meta", parent=styles["Normal"], textColor=SLATE, fontSize=8.8, leading=12,
                            leftIndent=16, spaceAfter=2)
cond_style = ParagraphStyle("Cond", parent=styles["Normal"], textColor=colors.HexColor("#9a4d12"), fontSize=8.2,
                            leading=11, leftIndent=16, spaceAfter=4)
note_style = ParagraphStyle("Note", parent=styles["Normal"], textColor=SLATE, fontSize=9.5, leading=13, spaceAfter=6)

TYPE_PT = {
    "single": "Escolha única",
    "multi": "Múltipla escolha",
    "select": "Lista suspensa",
    "dimensions": "Dimensões (L × C)",
    "number": "Número",
    "text": "Texto livre",
}

# Cada serviço: lista de (tipo, conteúdo)
#   ("section", "Nome da seção")
#   ("q", label, tipo, [opções], "condição opcional", optional_bool)
#   ("note", "texto")

def Q(label, t, options=None, cond=None, optional=False):
    return ("q", label, t, options or [], cond, optional)

def S(name):
    return ("section", name)

def N(text):
    return ("note", text)

DATA = {
 "Bathroom — Banheiro": [
    S("1. Visão Geral & Demolição"),
    Q("Dimensões do banheiro (L × C)", "dimensions"),
    Q("Pé-direito (ft)", "number", optional=True),
    Q("Escopo de demolição", "single", ["Parcial (chuveiro/piso/pia)", "Demolição total", "Sem demolição"]),
    Q("Notas de demolição", "text", cond="se demolição parcial ou total", optional=True),
    Q("Mudar o layout?", "single", ["Sim", "Não"]),
    Q("Descrever a mudança de layout", "text", cond="se mudar layout = Sim"),
    S("2. Chuveiro & Banheira"),
    Q("Banheira existente?", "single", ["Sim", "Não"]),
    Q("O que fazer com a banheira?", "single", ["Manter", "Restaurar", "Remover"], cond="se banheira existente = Sim"),
    Q("Tamanho da banheira", "text", cond="se banheira existente e não for remover", optional=True),
    Q("Banheira free-standing?", "single", ["Sim", "Não"]),
    Q("Tamanho e local da banheira free-standing", "text", cond="se free-standing = Sim"),
    Q("Vai ter chuveiro?", "single", ["Sim", "Não"]),
    Q("Tamanho do chuveiro", "dimensions", cond="se chuveiro = Sim"),
    Q("Material da parede do chuveiro", "single", ["Porcelanato", "Cerâmica", "Pedra natural", "Large format"], cond="se chuveiro = Sim"),
    Q("Com soleira (curb) ou sem (curbless)?", "single", ["Com soleira", "Curbless"], cond="se chuveiro = Sim"),
    Q("Dimensões e material da soleira", "text", cond="se com soleira"),
    Q("Posição do ralo", "single", ["Centro", "Linear — na parede", "Canto"], cond="se chuveiro = Sim"),
    Q("Enclausuramento de vidro", "single", ["Frameless", "Semi-frameless", "Cortina", "Nenhum"], cond="se chuveiro = Sim"),
    S("3. Vaso & Bidê"),
    Q("Vaso sanitário", "single", ["Manter", "Substituir", "Realocar (checar viga)"]),
    Q("Modelo do vaso & notas de local", "text", cond="se substituir ou realocar", optional=True),
    Q("Bidê?", "single", ["Sim", "Não"]),
    Q("Local, modelo & distância do painel elétrico", "text", cond="se bidê = Sim"),
    S("4. Pia & Marcenaria (Vanity)"),
    Q("Vanity (gabinete)", "single", ["Manter", "Restaurar", "Substituir"]),
    Q("Pia simples ou dupla?", "single", ["Simples", "Dupla"], cond="se substituir"),
    Q("Tamanho & estilo do vanity", "text", cond="se substituir", optional=True),
    Q("Vanity elétrico?", "single", ["Sim", "Não"]),
    Q("Tamanho & specs do vanity elétrico", "text", cond="se vanity elétrico = Sim"),
    Q("Toalheiro elétrico?", "single", ["Sim", "Não"]),
    Q("Tamanho & specs do toalheiro", "text", cond="se toalheiro elétrico = Sim"),
    Q("Armário com espelho (medicine cabinet)", "single", ["Embutido", "Sobrepor", "Elétrico", "Nenhum"]),
    S("5. Conforto & Ventilação"),
    Q("Exaustor", "single", ["Substituir existente", "Adicionar novo (checar vent)", "Manter existente"]),
    Q("Modelo & local do exaustor", "text", cond="se substituir ou adicionar"),
    Q("Piso aquecido?", "single", ["Sim — Elétrico", "Sim — Hidrônico", "Não"]),
    Q("Área do piso aquecido (sqft)", "text", cond="se piso aquecido"),
    Q("Steam shower (sauna)?", "single", ["Sim", "Não"]),
    Q("Local, tamanho da sala & modelo", "text", cond="se steam shower = Sim"),
    S("6. Hidráulica & Louças"),
    Q("Reconfiguração hidráulica?", "single", ["Sim", "Não"]),
    Q("Descrever mudanças hidráulicas", "text", cond="se reconfiguração = Sim"),
    Q("Trocar válvula do chuveiro?", "single", ["Sim", "Não"]),
    Q("Modelo da válvula, jatos & local", "text", cond="se trocar válvula = Sim"),
    Q("Chuveiro (shower head) — descrever local", "text", optional=True),
    Q("Chuveiro de chuva (rain shower)?", "single", ["Sim", "Não"]),
    Q("Local & quantidade do rain shower", "text", cond="se rain shower = Sim"),
    Q("Ducha de mão (hand held)?", "single", ["Sim", "Não"]),
    Q("Local & quantidade da ducha de mão", "text", cond="se hand held = Sim"),
    Q("Trocar registro de água (water valve)?", "single", ["Sim", "Não"]),
    Q("Modelo do registro", "text", cond="se trocar registro = Sim"),
    S("7. Iluminação & Elétrica"),
    Q("LED no chuveiro (na niche)?", "single", ["Sim", "Não"]),
    Q("Espelho LED (elétrico)?", "single", ["Sim", "Não"]),
    Q("Tamanho & modelo do espelho", "text", cond="se espelho LED = Sim"),
    Q("Arandelas (sconces)?", "single", ["Sim", "Não"]),
    Q("Local & quantidade das arandelas", "text", cond="se arandelas = Sim"),
    Q("Troca geral de iluminação?", "single", ["Sim", "Não"]),
    Q("Tamanho & modelo da iluminação", "text", cond="se troca de iluminação = Sim"),
    Q("Luminárias adicionais?", "single", ["Sim", "Não"]),
    Q("Atualizar tomadas / interruptores?", "single", ["Sim", "Não"]),
    Q("Modelo de tomadas / interruptores", "text", cond="se atualizar = Sim"),
    Q("Capa de aquecedor de rodapé?", "single", ["Sim", "Não"]),
    Q("Tamanho & modelo do aquecedor", "text", cond="se capa de aquecedor = Sim"),
    Q("Capacidade do painel", "single", ["100 Amp", "200 Amp", "Não sei"]),
    S("8. Azulejo, Niche & Banco"),
    Q("Material do azulejo", "text"),
    Q("Tamanho & padrão do azulejo", "text"),
    Q("Altura do azulejo na parede", "single", ["4 ft", "Altura total", "Até o teto"]),
    Q("Niche (nicho)?", "single", ["Nenhum", "1 niche", "2 niches"]),
    Q("Local & tamanho do niche (mín 12\" de altura)", "text", cond="se 1 ou 2 niches"),
    Q("Banco embutido?", "single", ["Sim", "Não"]),
    Q("Local & tamanho do banco", "text", cond="se banco = Sim"),
    S("9. Itens Fornecidos pelo Cliente"),
    Q("Itens que o cliente deve comprar (Omega NÃO fornece)", "multi",
      ["Vanity", "Faucet", "Toilet", "Bathtub", "Free-standing tub", "Shower valve", "Hand held",
       "Shower head", "Rain shower", "Shower trims", "Sconces", "Pendants", "Exhaust fan", "Tile",
       "Tile nose", "Grout & silicone", "Stone for niche", "Stone for curb",
       "Water valve (black/bronze/brass)", "Outros acabamentos custom"]),
    S("10. Permit & Extras"),
    Q("Permit (alvará)", "single", ["Já tem", "Precisa tirar", "Não sei"]),
    Q("Algum outro pedido?", "text", optional=True),
 ],

 "Kitchen — Cozinha": [
    S("1. Visão Geral & Demolição"),
    Q("Dimensões da cozinha (L × C)", "dimensions"),
    Q("Pé-direito (ft)", "number"),
    Q("Demolição", "single", ["Sem demolição", "Parcial", "Total"]),
    Q("Notas de demolição", "text", cond="se parcial ou total", optional=True),
    Q("Layout", "single", ["Mesmo layout (fotos com dimensões de cada armário)", "Mudar layout"]),
    Q("Descrever a mudança de layout", "text", cond="se mudar layout"),
    S("2. Armários & Bancada"),
    N("Cascata de armários: Fabricante → Série/Coleção → Linha → Cor. "
      "As opções vêm do catálogo (FGM, Fabuwood, ou Custom). Quando 'Custom', "
      "um campo de texto livre aparece pra marca/linha/cor."),
    Q("Fabricante do armário", "single", ["(catálogo: FGM, Fabuwood, Custom, ...)"]),
    Q("Fabricante / linha custom", "text", cond="se fabricante = Custom"),
    Q("Série / Coleção", "single", ["(depende do fabricante)"], cond="se FGM ou Fabuwood"),
    Q("Linha", "single", ["(depende da série)"], cond="se a série exigir"),
    Q("Cor / acabamento do armário", "select", ["(depende de marca/série/linha)"], cond="após escolher série/linha"),
    Q("Dimensões dos armários", "text"),
    Q("Material da bancada", "text", ["Quartzo / granito / mármore / butcher block"]),
    Q("Dimensões da bancada", "text"),
    Q("Precisa de isolamento (insulation)?", "single", ["Sim", "Não"]),
    Q("Dimensões do isolamento", "text", cond="se isolamento = Sim"),
    S("3. Hidráulica & Gás"),
    Q("Pia", "single", ["Manter existente", "Substituir", "Realocar (checar acesso embaixo)"]),
    Q("Material, tamanho & estilo da pia", "text", cond="se substituir ou realocar"),
    Q("Local da pia", "text", cond="se realocar"),
    Q("Pot filler (torneira na parede do fogão)?", "single", ["Sim", "Não"]),
    Q("Local do pot filler", "text", cond="se pot filler = Sim"),
    Q("Linha de gás", "single", ["Não se aplica", "Manter existente", "Nova instalação", "Realocar"]),
    Q("Local da linha de gás", "text", cond="se instalar ou realocar"),
    Q("Coifa (hood)", "single", ["Manter existente", "Nova instalação (checar área externa)", "Realocar"]),
    Q("Local da coifa", "text", cond="se instalar ou realocar"),
    Q("Tanque de água quente instantânea?", "single", ["Sim", "Não"]),
    Q("Specs & local do água quente instantânea", "text", cond="se = Sim"),
    S("4. Eletrodomésticos"),
    Q("Microondas", "select", ["Manter", "Sem microondas", "Sobre o fogão (OTR)", "Embutido", "Drawer", "Bancada", "Custom"]),
    Q("Local & spec do microondas", "text", cond="se não for Manter/Nenhum", optional=True),
    Q("Forno (oven)", "select", ["Manter", "Sem forno separado", "Simples gás", "Simples elétrico", "Duplo gás", "Duplo elétrico", "Custom"]),
    Q("Tamanho & spec do forno", "text", cond="se não for Manter/Nenhum"),
    Q("Fogão (stove)", "select", ["Manter", "Sem fogão", "Gás", "Elétrico", "Indução"]),
    Q("Tamanho do fogão", "text", cond="se não for Manter/Nenhum"),
    Q("Cooktop", "select", ["Manter", "Sem cooktop separado", "Gás", "Elétrico", "Indução"]),
    Q("Tamanho do cooktop", "text", cond="se não for Manter/Nenhum"),
    Q("Rangetop de bocas (burner)?", "single", ["Sim", "Não"]),
    Q("Tamanho do burner rangetop", "text", cond="se = Sim"),
    Q("Forno a vapor (steam oven)?", "single", ["Sim", "Não"]),
    Q("Gás/elétrico & tamanho do steam oven", "text", cond="se = Sim"),
    Q("Notas de eletrodomésticos", "text", optional=True),
    S("5. Janelas & Portas"),
    Q("Janela", "single", ["Manter existente", "Substituir", "Realocar (checar externo & siding)"]),
    Q("Local & notas da janela", "text", cond="se substituir ou realocar"),
    Q("Porta", "single", ["Manter existente", "Substituir", "Realocar (checar externo & siding)"]),
    Q("Local & notas da porta", "text", cond="se substituir ou realocar"),
    S("6. Iluminação & Elétrica"),
    Q("Spots embutidos (recessed)?", "single", ["Sim", "Não"]),
    Q("Quantidade & local dos spots", "text", cond="se recessed = Sim"),
    Q("Luz sob o armário (undercabinet)?", "single", ["Sim", "Não"]),
    Q("Metros lineares de undercabinet", "text", cond="se = Sim"),
    Q("Arandelas (sconces)?", "single", ["Sim", "Não"]),
    Q("Quantidade & local das arandelas", "text", cond="se = Sim"),
    Q("Pendentes (pendants)?", "single", ["Sim", "Não"]),
    Q("Quantidade & local dos pendentes", "text", cond="se = Sim"),
    Q("Tomadas / interruptores — quantidade & local", "text", optional=True),
    S("7. Pisos, Azulejo & Acabamento"),
    Q("Material do backsplash", "text"),
    Q("Tamanho & padrão do backsplash", "text"),
    Q("Altura do backsplash", "single", ["Altura total (até teto/armários)", "Padrão 18\"", "Custom"]),
    Q("Altura custom do backsplash", "text", cond="se altura = Custom"),
    Q("Material do piso", "single", ["Manter existente", "Hardwood", "Azulejo", "Vinil"]),
    Q("Material, tamanho, cor do stain, área do piso", "text", cond="se não for Manter"),
    Q("Trabalho de acabamento (trim)?", "single", ["Sim", "Não"]),
    Q("Modelo, tamanho, quantidade de crown molding", "text", cond="se trim = Sim"),
    Q("Pintura?", "single", ["Sim", "Não"]),
    Q("Escopo da pintura (cômodos, acabamentos)", "text", cond="se pintura = Sim"),
    S("8. Itens Fornecidos pelo Cliente"),
    Q("Itens que o cliente deve comprar (Omega NÃO fornece)", "multi",
      ["Eletrodomésticos", "Farm sink / pia especial", "Faucet", "Pot filler faucet", "Pendants",
       "Sconces", "Puxadores de armário", "Tile", "Tile nose", "Tile grout", "Silicone na cor do grout"]),
    S("9. Permit, Orçamento & Extras"),
    Q("Permit (alvará)", "single", ["Já tem", "Precisa tirar", "Não obrigatório", "Não sei"]),
    Q("Inspeções obrigatórias?", "single", ["Sim — agendar com a cidade", "Não", "Não sei"]),
    Q("Algum outro pedido?", "text", optional=True),
    Q("Faixa de orçamento do cliente", "single",
      ["< $20k", "$20k–40k", "$40k–60k", "$60k–80k", "$80k–100k", "$100k–150k", "> $150k", "Flexível / não informado"]),
    Q("Notas de orçamento", "text", optional=True),
 ],

 "Roofing — Telhado": [
    S("1. Visão Geral"),
    Q("Quantos squares?", "number"),
    Q("Quantas camadas existentes?", "number", optional=True),
    Q("Tipo de substituição", "single", ["Substituição total", "Substituição parcial"]),
    S("2. Material do Telhado"),
    Q("Material do telhado", "single", ["Telha asfáltica", "Standing seam metal", "Cedar", "Outro"]),
    Q("Marca & cor da telha asfáltica", "text", cond="se asfáltica"),
    Q("Cor do telhado metálico", "text", cond="se standing seam"),
    Q("Especificar outro material", "text", cond="se Outro"),
    Q("Underlayment (manta)?", "single", ["Sim", "Não"]),
    S("3. Rufos (Flashing)"),
    Q("Step flashing?", "single", ["Sim", "Não"]),
    Q("Tipo & cor do step flashing", "text", cond="se = Sim"),
    Q("Eave flashing?", "single", ["Sim", "Não"]),
    Q("Tipo & cor do eave flashing", "text", cond="se = Sim"),
    Q("Drip edge?", "single", ["Sim", "Não"]),
    Q("Tipo & cor do drip edge", "text", cond="se = Sim"),
    Q("Rufo de chaminé (chimney flashing)?", "single", ["Sim", "Não"]),
    Q("Quantidade & material do rufo de chaminé", "text", cond="se = Sim"),
    S("4. Vents & Tubos"),
    Q("Boot pipe?", "single", ["Sim", "Não"]),
    Q("Tipo, tamanho & quantidade do boot pipe", "text", cond="se = Sim"),
    Q("Ridge vent (ventilação de cumeeira)?", "single", ["Sim", "Não"]),
    Q("Tamanho do ridge vent", "text", cond="se = Sim"),
    S("5. Reparos & Substituições"),
    Q("Substituição de compensado (plywood)?", "single", ["Sim", "Não"]),
    Q("Quantidade de plywood", "text", cond="se = Sim"),
    Q("Substituição de calhas (gutters)?", "single", ["Sim", "Não"]),
    Q("Metros de calha & quantidade de downspout", "text", cond="se = Sim"),
    S("6. Permit & Extras"),
    Q("Permit (alvará)", "single", ["Já tem", "Precisa tirar", "Não sei"]),
    Q("Algum outro pedido?", "text", optional=True),
 ],

 "Deck — Deck/Varanda  (ATUALIZADO)": [
    S("1. Visão Geral"),
    Q("Tipo de projeto", "single", ["New build (novo)", "Replacement (substituição)", "Extension (ampliar deck existente)"]),
    Q("Descrever a ampliação do deck", "text", cond="se tipo = Extension"),
    Q("Dimensões do deck (L × C)", "dimensions"),
    Q("Material do deck", "single", ["Pressure Treated Wood", "Cedar", "Composite (Trex / TimberTech)"]),
    Q("Tipo de board (tábua)", "single", ["Grooved (ranhurado)", "Solid (sólido)"]),
    Q("Material & quantidade dos boards", "text"),
    Q("Hidden screws (parafusos ocultos)?", "single", ["Sim", "Não"]),
    Q("Sistema de hidden screws", "text", cond="se hidden screws = Sim"),
    Q("Picture frame (moldura)?", "single", ["Sim", "Não"]),
    Q("Material & quantidade do picture frame", "text", cond="se picture frame = Sim"),
    Q("Building plans (plantas)?", "single", ["Cliente tem", "Precisa desenhar", "Não precisa"]),
    Q("Demolição necessária?", "single", ["Sim", "Não"]),
    Q("Altura do deck em relação ao chão", "single", ["Menos de 30\"", "30\" a 6 ft", "Mais de 6 ft"]),
    Q("Encostado (attached) ou independente (freestanding)?", "single", ["Attached", "Freestanding"]),
    Q("Siding (revestimento) da casa", "single", ["Vinyl", "Wood", "Stucco", "Brick", "Stone"], cond="se attached"),
    S("2. Fundação & Estrutura"),
    Q("Footings (sapatas)?", "single", ["Sim", "Não"]),
    Q("Quantidade de footings", "number", cond="se footings = Sim"),
    Q("Simpson Strong Tie?", "single", ["Sim", "Não"]),
    Q("Quantidade de Strong Tie (checar dentro também)", "number", cond="se = Sim"),
    Q("Substituição de floor?", "single", ["Sim", "Não"]),
    Q("Sqft do floor, quantidade, quantos degraus", "text", cond="se = Sim"),
    Q("Substituição de stringer (viga da escada)?", "single", ["Sim", "Não"]),
    Q("Tamanho & quantidade de stringer", "text", cond="se = Sim"),
    Q("Substituição de joist (vigota)?", "single", ["Sim", "Não"]),
    Q("Substituição de beam (viga)?", "single", ["Sim", "Não"]),
    Q("Substituição de rim board?", "single", ["Sim", "Não"]),
    Q("Substituição de flashing?", "single", ["Sim", "Não"]),
    Q("Descrever flashing", "text", cond="se = Sim"),
    Q("Instalação de posts (colunas)?", "single", ["Sim", "Não"]),
    Q("Quantidade de posts a instalar", "number", cond="se = Sim"),
    Q("Substituição de posts?", "single", ["Sim", "Não"]),
    Q("Quantidade de posts a substituir", "number", cond="se = Sim"),
    S("3. Guarda-corpos & Colunas (Railings)"),
    Q("Hand rail (corrimão)?", "single", ["Sim", "Não"]),
    Q("Material do hand rail (deve seguir o código)", "text", cond="se = Sim"),
    Q("Railing (guarda-corpo)?", "single", ["Sim", "Não"]),
    Q("Material, quantidade & balaústre do railing", "text", cond="se = Sim"),
    Q("Railing post?", "single", ["Sim", "Não"]),
    Q("Material & quantidade do railing post", "text", cond="se = Sim"),
    Q("Post sleeve (revestimento da coluna)?", "single", ["Sim", "Não"]),
    Q("Material & quantidade do post sleeve", "text", cond="se = Sim"),
    Q("Post skirt (saia da coluna)?", "single", ["Sim", "Não"]),
    Q("Material & quantidade do post skirt", "text", cond="se = Sim"),
    S("4. Guardrail & Escadas"),
    Q("Guardrail (obrigatório acima de 30\" em CT)", "single", ["Não precisa", "Sim — precisa"]),
    Q("Material do guardrail", "single", ["PT Wood", "Aluminum", "Cable rail", "Glass"], cond="se guardrail = precisa"),
    Q("Escadas", "single", ["Não precisa", "Sim"]),
    Q("Quantos lances (flights)?", "single", ["1", "2", "3 ou mais"], cond="se escadas = Sim"),
    Q("Precisa de patamar (landing)?", "single", ["Sim", "Não"], cond="se escadas = Sim"),
    S("5. Trim & Extras"),
    Q("Portão (gate)?", "single", ["Sim", "Não"]),
    Q("Material, quantidade & tamanho do portão", "text", cond="se gate = Sim"),
    Q("Fascia board (acabamento Azek)?", "single", ["Azek (PVC)", "Sem fascia"]),
    Q("Lattice (treliça embaixo do deck)?", "single", ["Sim", "Não"]),
    Q("Quantidade de lattice", "number", cond="se lattice = Sim"),
    Q("Outros extras embutidos", "multi",
      ["Pergola / cobertura", "Banco embutido", "Floreira embutida", "Iluminação embutida",
       "Linha de gás / Firepit", "Base para hot tub", "Nenhum"]),
    Q("Algum pedido especial?", "text", optional=True),
    S("6. Permit"),
    Q("Permit (alvará)", "single", ["Já tem", "Precisa tirar", "Não sei"]),
 ],

 "Flooring — Pisos": [
    S("1. Informações Gerais"),
    Q("Quais cômodos estão incluídos?", "multi",
      ["Living Room", "Dining Room", "Kitchen", "Hallway", "Bedroom(s)", "Bathroom(s)", "Basement", "Casa inteira"]),
    Q("Área total a cobrir", "number", ["unidade: sq ft"]),
    S("2. Piso Existente"),
    Q("Qual é o piso atual?", "single", ["Hardwood", "Engineered wood", "LVP / Vinil", "Laminate", "Tile", "Carpet", "Concreto / subfloor", "Outro"]),
    Q("Remover o piso existente?", "single", ["Sim — remover e descartar", "Não — instalar por cima"]),
    Q("Condição do subfloor", "single", ["Bom — pronto", "Precisa correção leve", "Precisa substituição parcial", "Não sei"]),
    S("3. Material Novo"),
    Q("Material do piso novo", "single", ["Solid Hardwood", "Engineered Wood", "LVP / Vinyl Plank", "Laminate", "Tile / Porcelanato", "Carpet", "Concreto polido"]),
    Q("Marca ou linha preferida", "text", optional=True),
    Q("Cor / acabamento preferido", "text"),
    Q("Padrão de instalação", "single", ["Reto (padrão)", "Diagonal", "Herringbone", "Chevron", "Random stagger"],
      cond="só para hardwood/engineered/lvp/laminate"),
    S("4. Escopo"),
    Q("Rodapés (baseboards)", "single", ["Manter existente", "Remover & substituir", "Instalar onde falta"]),
    Q("Transições entre cômodos / portas", "single", ["Strips na mesma cor", "Strips contrastantes", "Transição flush (sem strip)", "Não se aplica"]),
    Q("Incluir escadas?", "single", ["Sim", "Não"]),
    Q("Número de degraus", "number", cond="se escadas = Sim"),
    S("5. Logística"),
    Q("Quem move os móveis?", "single", ["Cliente move", "Omega cuida disso", "Cômodos estarão vazios"]),
    Q("Prazo desejado", "single", ["ASAP (1-2 semanas)", "Em até 1 mês", "Flexível"]),
 ],
}

SUBCONTRACTED_NOTE = (
    "Survey (Topografia) e Building Plans (Plantas) são serviços "
    "subcontratados pela Omega — não têm questionário. No app aparecem com "
    "o selo 'Subcontracted'. Qualquer serviço sem questionário detalhado "
    "cai num formulário genérico de 2 campos: 'Descreva o escopo do projeto' "
    "(texto) + 'Permit' (Já tem / Precisa tirar / Não sei)."
)


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def build():
    out_path = r"C:\Users\ramon\Documents\Questionarios-Omega.pdf"
    doc = SimpleDocTemplate(out_path, pagesize=letter,
                            leftMargin=0.7 * inch, rightMargin=0.7 * inch,
                            topMargin=0.7 * inch, bottomMargin=0.7 * inch,
                            title="Omega — Questionários de Visita")
    story = []

    # Capa
    story.append(Spacer(1, 1.2 * inch))
    story.append(Paragraph("Omega Development LLC", title_style))
    story.append(Paragraph("Questionários de Visita — Referência Completa", sub_style))
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=2, color=ORANGE))
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        f"Gerado em {date.today().strftime('%d/%m/%Y')}. Reflete o estado atual de "
        "<b>src/apps/sales/data/questionnaire.js</b>. Cada serviço lista as perguntas "
        "na ordem em que aparecem no app, com o tipo de resposta e as opções. "
        "Perguntas condicionais (que só aparecem dependendo de respostas anteriores) "
        "estão marcadas com a condição em laranja.", note_style))
    story.append(Spacer(1, 16))
    # Índice
    story.append(Paragraph("Serviços neste documento", section_style))
    for name in DATA.keys():
        nsec = sum(1 for e in DATA[name] if e[0] == "section")
        nq = sum(1 for e in DATA[name] if e[0] == "q")
        story.append(Paragraph(f"• <b>{esc(name)}</b> — {nsec} seções, {nq} perguntas", meta_style))
    story.append(Paragraph("• <b>Survey & Building Plans</b> — subcontratados (sem questionário)", meta_style))
    story.append(Spacer(1, 10))
    story.append(Paragraph(SUBCONTRACTED_NOTE, note_style))

    for name, entries in DATA.items():
        story.append(PageBreak())
        story.append(Paragraph(esc(name), service_style))
        qnum = 0
        for e in entries:
            if e[0] == "section":
                story.append(Paragraph(esc(e[1]), section_style))
                story.append(HRFlowable(width="100%", thickness=0.6, color=GREYLINE, spaceAfter=4))
            elif e[0] == "note":
                story.append(Paragraph("Nota: " + esc(e[1]), cond_style))
            else:
                _, label, t, options, cond, optional = e
                qnum += 1
                opt_flag = "  <font color='#9a9a96'>(opcional)</font>" if optional else ""
                story.append(Paragraph(f"<b>{qnum}. {esc(label)}</b>{opt_flag}", q_style))
                tipo = TYPE_PT.get(t, t)
                meta = f"<i>{tipo}</i>"
                if options:
                    meta += ": " + " · ".join(esc(o) for o in options)
                story.append(Paragraph(meta, meta_style))
                if cond:
                    story.append(Paragraph("» aparece " + esc(cond), cond_style))

    doc.build(story)
    print("PDF gerado:", out_path)


if __name__ == "__main__":
    build()
