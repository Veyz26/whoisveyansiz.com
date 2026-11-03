<?php
// Copy to dev/config.php for local development (gitignored). Production config lives OUTSIDE public_html:
// /home/<user>/domains/whoisveyansiz.com/budget-private/config.php  (see README → Deploy).
return [
    'app_name' => 'KAVE Budget',
    'db_path' => __DIR__ . '/data/dev.db',
    'private_mode' => true,                       // only the emails below can sign in; no billing
    'allowed_emails' => ['you@example.com', 'partner@example.com'],
    'setup_codes' => ['you@example.com' => 'make-a-random-code', 'partner@example.com' => 'another-random-code'],  // one-time codes for creating a password account
    'password_login' => true,                     // needed for first-time setup; after that, password + recovery code only
    'require_passkey' => true,                    // everyone adds Face ID / Touch ID before using the app
    'microsoft' => [                              // optional; leave empty if you don't use Microsoft sign-in
        'client_id' => '',                        // Azure app registration → Application (client) ID
        'client_secret' => '',                    // Certificates & secrets → client secret VALUE
        'tenant' => 'consumers',                  // personal Microsoft accounts; or your tenant ID
        'trusted_tenants' => [],
    ],
    'public_url' => 'http://localhost:8766/private',
    'secure_cookies' => false,                    // true in production (HTTPS)
    'env' => 'development',
    'demo' => true,                               // "Explore the demo" button (never in production)
];
