### Pinterest Downloader
Script para fazer dump de pastas do pinterest

#### Comandos
- node . login: gera os cookies usados para entrar em uma sessão já logado
- node . download [URL]: Faz download de uma pasta e a coloca dentro da pasta output do projeto
    * Usando a flag `-l[LIMIT_COUNT]`, você limita a quantidade de media baixados
    * Usando a flag `-D`, você remove os pins da pasta na sua conta (precisa estar logado para isso)
    * Usando a flag `-r`, você baixa também as subpastas


#### Como rodar este projeto
- na raiz desse projeto rode `npm i`
- instale o ffmpeg (já que ele é dependencia para baixar videos) e certifique que consegue chamar ele pelo terminal
- duplique o arquivo `env.example`, retirando o `.example` e colocando os dados necessários
- para o campo CHROME_PATH, dá para obter esse dado acessando a url `chrome://version/` no chrome
- **IMPORTANTE**: Como dados sensíveis estão sendo usados, provavelmente você queira apagar os dados de login e senha depois de rodar o comando de login, ainda vou melhorar isso no futuro
- rode o comando `npm run build`
- rode o comando `node . download https://br.pinterest.com/[USUARIO]/[PASTA]`, trocando o usuario e a pasta para os valores que você quer