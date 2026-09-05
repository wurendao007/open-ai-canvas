$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "KraftReel CLI 需要 Node.js 18+ 和 npm，请先安装 Node.js：https://nodejs.org/"
}

npm install --global kraftreel-cli
Write-Output "KraftReel CLI 安装完成。首次使用请运行：kraftreel login web"
