# Firebase Schema

## Coleção: clientes

| Campo | Tipo |
| --- | --- |
| id | string |
| nome | string |
| telefone | string |
| observacoes | string |
| dataCadastro | timestamp |

## Coleção: servicos

| Campo | Tipo |
| --- | --- |
| id | string |
| nome | string |
| valorPadrao | number |
| duracaoMinutos | number |
| ativo | boolean |
| dataCadastro | timestamp |

## Coleção: agendamentos

| Campo | Tipo |
| --- | --- |
| id | string |
| clienteId | reference/string |
| nomeCliente | string |
| telefone | string |
| servicoId | reference/string |
| nomeServico | string |
| valorServico | number |
| descontoTipo | string |
| descontoValor | number |
| valorFinal | number |
| dataHoraInicio | timestamp |
| dataHoraFim | timestamp |
| status | string |
| observacoes | string |
| financeiroGerado | boolean |
| dataCadastro | timestamp |

Valores de `status`:

- `Agendado`
- `Confirmado`
- `Concluído`
- `Cancelado`

Valores de `descontoTipo`:

- `nenhum`
- `valor`
- `porcentagem`

## Coleção: financeiro

| Campo | Tipo |
| --- | --- |
| id | string |
| tipo | string |
| descricao | string |
| categoria | string |
| valor | number |
| data | timestamp |
| origem | string |
| agendamentoId | reference/string opcional |
| dataCadastro | timestamp |

Valores de `tipo`:

- `entrada`
- `saida`

Valores de `origem`:

- `manual`
- `agendamento`

## Índices Recomendados

Crie índices compostos para:

- `agendamentos`: `dataHoraInicio` asc, `status` asc
- `agendamentos`: `clienteId` asc, `dataHoraInicio` desc
- `financeiro`: `data` desc, `tipo` asc
- `financeiro`: `origem` asc, `agendamentoId` asc
