# Installation and networking

Follow the root README. The process fails closed when the master key or bootstrap token is missing/malformed. `.env` is consumed by Compose; local Node uses `node --env-file=.env dist/src/main.js`. `/health` tests process availability; `/ready` also tests local metadata storage. Neither reveals credentials/network configuration. Database health is tested through authenticated connection test endpoints, and an unavailable database does not terminate the server.

For a database on another LAN host, configure its actual LAN address: e.g. server 192.168.1.20, Oracle 192.168.1.25:1521/ORCL, PostgreSQL 192.168.1.30:5432/project. Ensure routing/firewall permits only the MCP host and use dedicated development accounts.

For a database on the Docker host use `host.docker.internal`. Compose supplies the Linux `host-gateway` mapping. For another Docker service, place both services on the same user-defined network and use its service name and internal port. `localhost` inside the gateway container refers to that container.

## Nginx example

```nginx
server {
    listen 443 ssl;
    server_name dbmcp.example.edu;
    ssl_certificate /etc/letsencrypt/live/dbmcp.example.edu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dbmcp.example.edu/privkey.pem;
    client_max_body_size 512k;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_read_timeout 120s;
    }
}
```

Set `PUBLIC_URL=https://dbmcp.example.edu`. Forward Authorization unchanged. Limit admin UI/API access to your administrative network; do not log authorization headers or bodies. The server intentionally does not trust forwarded IP headers; requests behind a single proxy share its in-process rate limit. Add per-client rate limits at the trusted proxy if needed.

## Apache example

```apache
<VirtualHost *:443>
    ServerName dbmcp.example.edu
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/dbmcp.example.edu/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/dbmcp.example.edu/privkey.pem
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3001/ timeout=120
    ProxyPassReverse / http://127.0.0.1:3001/
</VirtualHost>
```

Enable the installed Apache SSL/proxy/proxy_http modules using your OS package configuration. Arrange certificate issuance/renewal independently. Keep Compose's loopback binding when proxying on the host.

## Backup and shutdown

Stop the gateway before copying SQLite files or use a SQLite-aware online backup tool; copying only the main file while WAL writes are active is insufficient. Preserve the Docker volume and master key. SIGTERM stops requests, rolls back active transactions, closes pools and closes SQLite, with a 30-second shutdown deadline. Run a single gateway process per metadata volume.
