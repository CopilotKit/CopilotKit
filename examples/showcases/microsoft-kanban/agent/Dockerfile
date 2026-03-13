# Stage 1: Build
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Copy the agent project file and restore dependencies
# Note: Build context should be the parent directory (project root)
COPY agent/ProverbsAgent.csproj /src/agent/
WORKDIR /src/agent
RUN dotnet restore

# Copy the rest of the agent source
COPY agent/ .

# Build the project
RUN dotnet build -c Release -o /app/build

# Publish the project
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

# Stage 2: Runtime
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
WORKDIR /app

# Copy published output
COPY --from=build /app/publish .

# Expose port 8000
EXPOSE 8000

# Set ASP.NET Core to listen on port 8000
ENV ASPNETCORE_URLS=http://+:8000

# GitHubToken will be provided via environment variable at runtime
ENTRYPOINT ["dotnet", "ProverbsAgent.dll"]
