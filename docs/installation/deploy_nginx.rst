
Deploying with Nginx
====================

Example config
--------------

The following is an example of a working Nginx configuration file. Ngnix is used
as a reversed proxy to redirect request to a local running process, also using
SSL certificates. In the next section you can see the `Key Options`_ that were modified.

.. tab:: /etc/nginx/nginx.conf

    .. code-block:: nginx

        user nginx;
        worker_processes auto;
        error_log /var/log/nginx/error.log;
        pid /run/nginx.pid;

        # Load dynamic modules. See /usr/share/doc/nginx/README.dynamic.
        include /usr/share/nginx/modules/*.conf;

        events {
            worker_connections 1024;
        }

        http {
            log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                              '$status $body_bytes_sent "$http_referer" '
                              '"$http_user_agent" "$http_x_forwarded_for"';

            access_log  /var/log/nginx/access.log  main;

            sendfile            on;
            tcp_nopush          on;
            tcp_nodelay         on;
            keepalive_timeout   65;
            types_hash_max_size 2048;

            include             /etc/nginx/mime.types;
            default_type        application/octet-stream;

            # Load modular configuration files from the /etc/nginx/conf.d directory.
            # See http://nginx.org/en/docs/ngx_core_module.html#include
            # for more information.
            include /etc/nginx/conf.d/*.conf;

            server {
                listen       443 ssl http2 default_server;
                listen       [::]:443 ssl http2 default_server;
                server_name   my-emhub.org;
                root         /usr/share/nginx/html;
                ssl on;
                ssl_certificate "/opt/ssl/certssl/myemhub.pem";
                ssl_certificate_key "/opt/ssl/certssl/myemhub.key";
                client_max_body_size 16M;

                # Load configuration files for the default server block.
                include /etc/nginx/default.d/*.conf;

                location / {
                proxy_pass http://localhost:5000;
                    proxy_http_version 1.1;
                    proxy_set_header Host $host;
                    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                }

                location /api/ {
                    proxy_pass http://localhost:5000/api/;
                    proxy_http_version 1.1;
                    proxy_set_header Host $host;
                    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                    proxy_buffering off;
                    proxy_read_timeout 1d;
                }

                error_page 404 /404.html;
                    location = /40x.html {
                }

                error_page 500 502 503 504 /50x.html;
                    location = /50x.html {
                }
            }

            server {
                if ($host = my-emhub.org) {
                    return 301 https://$host$request_uri;
                 } # managed by Certbot

                listen 80 ;
                listen [::]:80 ;
                server_name my-emhub.org;
                return 404; # managed by Certbot
            }

Key Options
-----------

Some of the explicit changes are commented below:

.. code-block:: nginx

    # Define the server name
    server_name   my-emhub.org;

    # Enable SSL
    ssl on;

    # Specify where your certificates are
    ssl_certificate "/opt/ssl/certssl/myemhub.pem";
    ssl_certificate_key "/opt/ssl/certssl/myemhub.key";

    # Increase the size of allowed file uploads
    # (Useful in EMhub when uplading images for Project's Entries)
    client_max_body_size 16M;

Moreover, we define two *locations* for the reverse proxy:

.. code-block:: nginx

    # Default root location
    location / {
    proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Another location for the API, to disable buffering and increase
    # the timeout, since this is required for long polling of some
    # worker processes
    location /api/ {
        proxy_pass http://localhost:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_read_timeout 1d;
    }

