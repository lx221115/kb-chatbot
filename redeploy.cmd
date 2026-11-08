@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "OLD_CP="
for /f "tokens=2 delims=:" %%i in ('chcp') do set "OLD_CP=%%i"
set "OLD_CP=%OLD_CP: =%"
chcp 936 >nul
title kb-chatbot Docker 重新部署
cd /d "%~dp0"

REM 线上部署配置（可选）：deploy\remote.env
set "REMOTE_HOST="
set "SSH_PORT="
if exist "deploy\remote.env" (
  for /f "usebackq tokens=1,* delims==" %%a in ("deploy\remote.env") do (
    if /i "%%a"=="SSH_HOST" set "REMOTE_HOST=%%~b"
    if /i "%%a"=="SSH_PORT" set "SSH_PORT=%%~b"
  )
)

REM 留空表示继承旧容器或使用脚本默认值
set "IMAGE_NAME="
set "CONTAINER_NAME=kb-chatbot"
set "HOST_PORT="
set "DATA_VOLUME="
set "ENV_FILE="
set "NO_BUILD=0"
set "USE_MIRROR=0"
set "DO_PULL=0"

call :find_bash
if not defined BASH (
  cls
  echo [错误] 未找到可用的 Git Bash（WSL 自带的 bash 无法执行脚本），请先安装 Git for Windows。
  echo        也可先设置环境变量 BASH_EXE 指向 bash.exe 再运行本脚本。
  echo.
  pause
  goto :done
)

:main
call :check_docker
call :check_container

set "LABEL_MODE=重新构建镜像并部署"
if "!NO_BUILD!"=="1" set "LABEL_MODE=仅重建容器（跳过构建）"
set "LABEL_MIRROR=默认（国内镜像）"
if "!USE_MIRROR!"=="1" set "LABEL_MIRROR=官方源（海外）"
set "LABEL_PULL=否"
if "!DO_PULL!"=="1" set "LABEL_PULL=是"
set "SHOW_IMAGE=继承旧容器 / kb-chatbot:latest"
if defined IMAGE_NAME set "SHOW_IMAGE=!IMAGE_NAME!"
set "SHOW_PORT=继承旧容器 / 3000"
if defined HOST_PORT set "SHOW_PORT=!HOST_PORT!"
set "SHOW_VOLUME=继承旧容器 / kb-chatbot-data"
if defined DATA_VOLUME set "SHOW_VOLUME=!DATA_VOLUME!"
set "SHOW_ENV=未指定"
if defined ENV_FILE set "SHOW_ENV=!ENV_FILE!"
set "SHOW_REMOTE=本地部署"
if defined REMOTE_HOST set "SHOW_REMOTE=!REMOTE_HOST!"

cls
echo ============================================================
echo  kb-chatbot Docker 重新部署
echo ============================================================
echo  项目目录 : %CD%
echo  Docker   : !DOCKER_STATUS!
echo  本地容器 : !CONT_STATUS!
echo  线上目标 : !SHOW_REMOTE!
echo ------------------------------------------------------------
echo  当前参数
echo    镜像名   : !SHOW_IMAGE!
echo    容器名   : %CONTAINER_NAME%
echo    宿主端口 : !SHOW_PORT!
echo    数据卷   : !SHOW_VOLUME!
echo    环境文件 : !SHOW_ENV!
echo    部署模式 : !LABEL_MODE!
echo    构建源   : !LABEL_MIRROR!
echo    构建前拉取基础镜像 : !LABEL_PULL!
echo ------------------------------------------------------------
echo  [1] 重新构建并部署
echo  [2] 仅重建容器（跳过构建）
echo  [3] 修改部署参数
echo  [4] 查看容器状态与日志
echo  [0] 退出
echo ============================================================
set "SEL="
set /p "SEL=请选择 [1]: "
if not defined SEL set "SEL=1"
if "!SEL!"=="1" (set "NO_BUILD=0" & goto :confirm)
if "!SEL!"=="2" (set "NO_BUILD=1" & goto :confirm)
if "!SEL!"=="3" goto :edit
if "!SEL!"=="4" goto :status
if "!SEL!"=="0" goto :done
echo 无效选项。
pause
goto :main

:edit
set "SHOW_IMAGE=继承旧容器 / kb-chatbot:latest"
if defined IMAGE_NAME set "SHOW_IMAGE=!IMAGE_NAME!"
set "SHOW_PORT=继承旧容器 / 3000"
if defined HOST_PORT set "SHOW_PORT=!HOST_PORT!"
set "SHOW_VOLUME=继承旧容器 / kb-chatbot-data"
if defined DATA_VOLUME set "SHOW_VOLUME=!DATA_VOLUME!"
set "SHOW_ENV=未指定"
if defined ENV_FILE set "SHOW_ENV=!ENV_FILE!"
set "SHOW_REMOTE=本地部署"
if defined REMOTE_HOST set "SHOW_REMOTE=!REMOTE_HOST!"
set "SHOW_PORT_SSH=默认 22"
if defined SSH_PORT set "SHOW_PORT_SSH=!SSH_PORT!"
set "LABEL_MIRROR=默认（国内镜像）"
if "!USE_MIRROR!"=="1" set "LABEL_MIRROR=官方源（海外）"
set "LABEL_PULL=否"
if "!DO_PULL!"=="1" set "LABEL_PULL=是"

cls
echo ============================================================
echo  修改部署参数（回车保持不变，输入 - 恢复默认/继承）
echo ============================================================
echo   [1] 镜像名      : !SHOW_IMAGE!
echo   [2] 容器名      : %CONTAINER_NAME%
echo   [3] 宿主机端口  : !SHOW_PORT!
echo   [4] 数据卷      : !SHOW_VOLUME!
echo   [5] 环境变量文件: !SHOW_ENV!
echo   [6] 构建源      : !LABEL_MIRROR!
echo   [7] 构建前拉取  : !LABEL_PULL!
echo   [8] 线上服务器  : !SHOW_REMOTE!
echo   [9] SSH 端口    : !SHOW_PORT_SSH!
echo   [0] 返回
echo ============================================================
set "SEL="
set /p "SEL=请选择要修改的项 [0]: "
if not defined SEL set "SEL=0"

if "!SEL!"=="1" (
  set "INPUT="
  set /p "INPUT=  新镜像名: "
  if not "!INPUT!"=="" (
    if "!INPUT!"=="-" (set "IMAGE_NAME=") else (set "IMAGE_NAME=!INPUT!")
  )
  goto :edit
)
if "!SEL!"=="2" (
  set "INPUT="
  set /p "INPUT=  新容器名: "
  if not "!INPUT!"=="" (
    if "!INPUT!"=="-" (set "CONTAINER_NAME=kb-chatbot") else (set "CONTAINER_NAME=!INPUT!")
  )
  goto :edit
)
if "!SEL!"=="3" (
  set "INPUT="
  set /p "INPUT=  新宿主机端口: "
  if not "!INPUT!"=="" (
    if "!INPUT!"=="-" (
      set "HOST_PORT="
    ) else (
      echo !INPUT!| findstr /r "^[0-9][0-9]*$" >nul
      if errorlevel 1 (
        echo  端口必须是数字。
        pause
      ) else (
        set "HOST_PORT=!INPUT!"
      )
    )
  )
  goto :edit
)
if "!SEL!"=="4" (
  set "INPUT="
  set /p "INPUT=  新数据卷名或宿主机目录: "
  if not "!INPUT!"=="" (
    if "!INPUT!"=="-" (set "DATA_VOLUME=") else (set "DATA_VOLUME=!INPUT!")
  )
  goto :edit
)
if "!SEL!"=="5" (
  set "INPUT="
  set /p "INPUT=  环境变量文件路径: "
  if not "!INPUT!"=="" (
    if "!INPUT!"=="-" (set "ENV_FILE=") else (set "ENV_FILE=!INPUT!")
  )
  goto :edit
)
if "!SEL!"=="6" (
  if "!USE_MIRROR!"=="0" (set "USE_MIRROR=1") else (set "USE_MIRROR=0")
  goto :edit
)
if "!SEL!"=="7" (
  if "!DO_PULL!"=="0" (set "DO_PULL=1") else (set "DO_PULL=0")
  goto :edit
)
if "!SEL!"=="8" (
  set "INPUT="
  set /p "INPUT=  线上服务器 user@host（回车不变，- 改为本地部署）: "
  if not "!INPUT!"=="" (
    if "!INPUT!"=="-" (set "REMOTE_HOST=") else (set "REMOTE_HOST=!INPUT!")
  )
  goto :edit
)
if "!SEL!"=="9" (
  set "INPUT="
  set /p "INPUT=  SSH 端口（回车不变，- 恢复默认 22）: "
  if not "!INPUT!"=="" (
    if "!INPUT!"=="-" (
      set "SSH_PORT="
    ) else (
      echo !INPUT!| findstr /r "^[0-9][0-9]*$" >nul
      if errorlevel 1 (
        echo  端口必须是数字。
        pause
      ) else (
        set "SSH_PORT=!INPUT!"
      )
    )
  )
  goto :edit
)
if "!SEL!"=="0" goto :main
echo 无效选项。
pause
goto :edit

:confirm
set "LABEL_MODE=重新构建镜像并部署"
if "!NO_BUILD!"=="1" set "LABEL_MODE=仅重建容器（跳过构建）"
set "SHOW_REMOTE=本地部署"
if defined REMOTE_HOST set "SHOW_REMOTE=!REMOTE_HOST!"
set ARGS= --container "%CONTAINER_NAME%"
if defined IMAGE_NAME set ARGS=!ARGS! --image "!IMAGE_NAME!"
if defined HOST_PORT set ARGS=!ARGS! --port "!HOST_PORT!"
if defined DATA_VOLUME set ARGS=!ARGS! --volume "!DATA_VOLUME!"
if defined ENV_FILE set ARGS=!ARGS! --env-file "!ENV_FILE!"
if defined REMOTE_HOST set ARGS=!ARGS! --ssh "!REMOTE_HOST!"
if defined REMOTE_HOST if defined SSH_PORT set ARGS=!ARGS! --ssh-port "!SSH_PORT!"
if "!NO_BUILD!"=="1" set ARGS=!ARGS! --no-build
if "!DO_PULL!"=="1" set ARGS=!ARGS! --pull

cls
echo ============================================================
echo  即将执行
echo ============================================================
echo    容器名   : %CONTAINER_NAME%
echo    镜像名   : !SHOW_IMAGE!
echo    宿主端口 : !SHOW_PORT!
echo    数据卷   : !SHOW_VOLUME!
echo    环境文件 : !SHOW_ENV!
echo    部署位置 : !SHOW_REMOTE!
echo    构建     : !LABEL_MODE!
echo    构建源   : !LABEL_MIRROR!
echo.
echo  bash scripts/redeploy.sh !ARGS!
echo ============================================================
set "CONFIRM="
set /p "CONFIRM=确认执行？[Y/n]: "
if /i "!CONFIRM!"=="n" goto :main

if "!USE_MIRROR!"=="1" (
  set "DEBIAN_MIRROR=deb.debian.org"
  set "NPM_REGISTRY=https://registry.npmjs.org"
) else (
  set "DEBIAN_MIRROR="
  set "NPM_REGISTRY="
)

docker version >nul 2>&1
if errorlevel 1 (
  echo.
  echo [错误] 无法连接 Docker，请先启动 Docker Desktop 并确认 docker 命令可用。
  echo.
  pause
  goto :main
)

echo.
echo ------------------------------------------------------------
"%BASH%" scripts/redeploy.sh !ARGS!
set "RC=!ERRORLEVEL!"
echo ------------------------------------------------------------
if "!RC!"=="0" (
  echo [完成] 部署成功。
) else (
  echo [失败] 部署返回码 !RC!，请查看上方输出。
)
echo.
pause
goto :main

:status
cls
echo ============================================================
echo  容器状态：%CONTAINER_NAME%
echo ============================================================
docker ps -a --filter "name=^/%CONTAINER_NAME%$"
echo.
echo ------------------------------------------------------------
echo  最近 30 行日志
echo ------------------------------------------------------------
docker logs --tail 30 %CONTAINER_NAME% 2>&1
echo.
pause
goto :main

:check_docker
docker version >nul 2>&1
if errorlevel 1 (
  set "DOCKER_STATUS=未连接，请启动 Docker Desktop"
) else (
  set "DOCKER_STATUS=已连接"
)
exit /b 0

:check_container
set "CONT_STATUS=未创建"
for /f "delims=" %%i in ('docker ps -a --filter "name=^/%CONTAINER_NAME%$" --format "{{.Status}}" 2^>nul') do set "CONT_STATUS=%%i"
exit /b 0

:find_bash
set "BASH="
if defined BASH_EXE if exist "%BASH_EXE%" call :pick_bash "%BASH_EXE%"
if defined BASH goto :eof
if exist "%ProgramFiles%\Git\bin\bash.exe" call :pick_bash "%ProgramFiles%\Git\bin\bash.exe"
if defined BASH goto :eof
if defined ProgramW6432 if exist "%ProgramW6432%\Git\bin\bash.exe" call :pick_bash "%ProgramW6432%\Git\bin\bash.exe"
if defined BASH goto :eof
if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" call :pick_bash "%ProgramFiles(x86)%\Git\bin\bash.exe"
if defined BASH goto :eof
if exist "%LocalAppData%\Programs\Git\bin\bash.exe" call :pick_bash "%LocalAppData%\Programs\Git\bin\bash.exe"
if defined BASH goto :eof
if exist "D:\Git\bin\bash.exe" call :pick_bash "D:\Git\bin\bash.exe"
if defined BASH goto :eof
for /f "delims=" %%i in ('where bash.exe 2^>nul') do (
  set "CAND=%%i"
  if not "!CAND!"=="!CAND:\Windows\=!" (
    echo [跳过] 忽略 Windows 自带的 WSL bash：%%i
  ) else (
    call :pick_bash "%%i"
  )
  if defined BASH goto :eof
)
exit /b 0

:pick_bash
if defined BASH goto :eof
"%~1" -c "exit 0" >nul 2>&1
if errorlevel 1 (
  echo [跳过] 无法运行：%~1
  exit /b 0
)
set "BASH=%~1"
exit /b 0

:done
if defined OLD_CP chcp !OLD_CP! >nul
endlocal
exit /b 0
