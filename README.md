# Rayssa Oliveira Gestão

Sistema de gestão para Rayssa Oliveira, nail designer, com foco em mobile, iPhone e web app.

## Como Abrir

Abra o arquivo `index.html` no navegador.

Para testar como PWA instalável no iPhone ou Android, publique a pasta em uma hospedagem HTTPS, como Firebase Hosting, Netlify ou Vercel. O manifesto já está configurado em `manifest.webmanifest`.

## Funcionalidades Implementadas

- Dashboard com receita do dia, receita do mês, despesas e lucro.
- Agenda com busca, filtro por data/status e edição rápida de status.
- Cadastro de clientes com histórico, total gasto e último atendimento.
- Cadastro de serviços com valor padrão, duração e status ativo/inativo.
- Financeiro com entradas, saídas, filtros por mês/tipo e resumo.
- Exportação CSV do financeiro.
- Exportação e importação de backup completo em JSON.
- Relatório financeiro em PDF via impressão do navegador.
- Envio de comprovante de agendamento via WhatsApp.
- Cálculo automático de desconto por valor fixo ou porcentagem.
- Cálculo automático do fim do agendamento conforme a duração do serviço.
- Bloqueio de agendamento sem valor.
- Bloqueio de conflito de horário.
- Geração automática de entrada no financeiro quando o status vira `Concluído`.
- Proteção contra lançamento financeiro duplicado usando `financeiroGerado`.

## Estrutura De Dados

O app usa `localStorage` nesta primeira versão para funcionar imediatamente sem configuração. A estrutura segue as coleções planejadas para Firestore:

- `clientes`
- `servicos`
- `agendamentos`
- `financeiro`

## Próxima Parte: Firebase Real

Para conectar ao Firebase, crie um projeto Firebase com:

- Authentication com e-mail/senha.
- Firestore Database.
- Storage, caso queira salvar PDFs gerados.
- Hosting para publicar o web app.

Depois substitua a camada de persistência local por chamadas Firestore usando os mesmos nomes de coleção. As regras iniciais estão em `firestore.rules`.

## FlutterFlow

Este projeto também serve como base funcional e visual para replicar no FlutterFlow:

- Crie as coleções conforme `firebase-schema.md`.
- Crie componentes equivalentes aos cards, formulários e badges.
- Configure as actions de cálculo no formulário de agendamento.
- Configure uma action ao alterar status para `Concluído` criando documento em `Financeiro`.
- Use query filters por data/status nas telas Agenda, Dashboard e Financeiro.
