@echo off
setlocal
where node >nul 2>nul || (echo KraftReel CLI 需要 Node.js 18+ 和 npm，请先安装 Node.js：https://nodejs.org/ & exit /b 1)
where npm >nul 2>nul || (echo KraftReel CLI 需要 Node.js 18+ 和 npm，请先安装 Node.js：https://nodejs.org/ & exit /b 1)
npm install --global kraftreel-cli
if errorlevel 1 exit /b %errorlevel%
echo KraftReel CLI 安装完成。首次使用请运行：kraftreel login web
