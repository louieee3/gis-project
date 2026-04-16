@echo off
chcp 65001 >nul
title GIS Project Launcher

echo ============================================================
echo  GIS Project 启动脚本
echo ============================================================
echo.

:: -------- 检查工作目录 --------
cd /d "%~dp0"

:: -------- 启动后端（FastAPI + uvicorn） --------
echo [1/2] 正在启动后端服务（FastAPI）...
start "GIS Backend" cmd /k "cd /d %~dp0 && uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload"

:: 等待后端初始化
timeout /t 3 /nobreak >nul

:: -------- 启动前端（Vite 开发服务器） --------
echo [2/2] 正在启动前端服务（Vite）...
start "GIS Frontend" cmd /k "cd /d %~dp0\frontend && npm run dev"

echo.
echo ============================================================
echo  服务启动中，请稍候...
echo  后端地址：http://localhost:8000
echo  前端地址：http://localhost:5173
echo ============================================================
echo.
pause
