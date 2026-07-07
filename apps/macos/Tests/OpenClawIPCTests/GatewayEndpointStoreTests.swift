import Foundation
import Testing
@testable import OpenClaw

struct GatewayEndpointStoreTests {
    private func makeLaunchAgentSnapshot(
        env: [String: String],
        token: String?,
        password: String?) -> LaunchAgentPlistSnapshot
    {
        LaunchAgentPlistSnapshot(
            programArguments: [],
            environment: env,
            stdoutPath: nil,
            stderrPath: nil,
            port: nil,
            bind: nil,
            token: token,
            password: password)
    }

    private func makeDefaults() -> UserDefaults {
        let suiteName = "GatewayEndpointStoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }

    // MARK: - isUnresolvedEnvPlaceholder unit tests

    @Test func `placeholder detects uppercase env var name`() {
        #expect(GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${OPENCLAW_GATEWAY_TOKEN}"))
    }

    @Test func `placeholder detects single uppercase char as minimum valid`() {
        #expect(GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${A}"))
    }

    @Test func `placeholder detects uppercase letters digits and underscores`() {
        #expect(GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${A_1}"))
    }

    @Test func `placeholder detects 128 char uppercase name length boundary`() {
        let name = String(repeating: "A", count: 128)
        #expect(GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${\(name)}"))
    }

    @Test func `placeholder trims surrounding whitespace before checking`() {
        #expect(GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("  ${MY_TOKEN}  "))
    }

    @Test func `placeholder rejects lowercase first character`() {
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${abc}"))
    }

    @Test func `placeholder rejects mixed case in name`() {
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${ABCdef}"))
    }

    @Test func `placeholder rejects digit as first character`() {
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${123_VAR}"))
    }

    @Test func `placeholder rejects underscore as first character`() {
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${_SECRET}"))
    }

    @Test func `placeholder rejects nonASCII uppercase letter`() {
        // É (U+00C9) is Unicode uppercase but not ASCII A-Z
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${\u{00C9}LI_TOKEN}"))
    }

    @Test func `placeholder rejects nonASCII digit`() {
        // \u{0660} is Arabic-Indic digit zero — Unicode Nd but not ASCII 0-9
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${TOKEN\u{0660}}"))
    }

    @Test func `placeholder rejects name exceeding 128 chars`() {
        let name = String(repeating: "A", count: 129)
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${\(name)}"))
    }

    @Test func `placeholder rejects value without dollar brace prefix`() {
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("MY_TOKEN"))
    }

    @Test func `placeholder rejects empty braces`() {
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${}"))
    }

    @Test func `placeholder rejects whitespace only in braces`() {
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${ }"))
    }

    @Test func `placeholder rejects double dollar escaped syntax`() {
        // $${VAR} is an escaped literal, not an env reference
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("$${MY_TOKEN}"))
    }

    @Test func `placeholder rejects string shorter than four chars`() {
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${}"))
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("${"))
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("}"))
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder(""))
    }

    // $NAME shorthand

    @Test func `placeholder detects dollar name shorthand`() {
        #expect(GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("$OPENCLAW_GATEWAY_TOKEN"))
    }

    @Test func `placeholder detects single char dollar shorthand`() {
        #expect(GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("$A"))
    }

    @Test func `placeholder rejects lowercase dollar shorthand`() {
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("$abc"))
    }

    @Test func `placeholder rejects digit leading dollar shorthand`() {
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("$123_TOKEN"))
    }

    @Test func `placeholder rejects escaped dollar brace still`() {
        // $${VAR} is escaped; starts with $$, not a single $
        #expect(!GatewayEndpointStore._testIsUnresolvedEnvPlaceholder("$${MY_TOKEN}"))
    }

    // MARK: - Token resolution tests

    @Test func `resolve gateway token prefers env and falls back to launchd`() {
        let snapshot = self.makeLaunchAgentSnapshot(
            env: ["OPENCLAW_GATEWAY_TOKEN": "launchd-token"],
            token: "launchd-token",
            password: nil)

        let envToken = GatewayEndpointStore._testResolveGatewayToken(
            isRemote: false,
            root: [:],
            env: ["OPENCLAW_GATEWAY_TOKEN": "env-token"],
            launchdSnapshot: snapshot)
        #expect(envToken == "env-token")

        let fallbackToken = GatewayEndpointStore._testResolveGatewayToken(
            isRemote: false,
            root: [:],
            env: [:],
            launchdSnapshot: snapshot)
        #expect(fallbackToken == "launchd-token")
    }

    @Test func `resolve gateway token ignores launchd in remote mode`() {
        let snapshot = self.makeLaunchAgentSnapshot(
            env: ["OPENCLAW_GATEWAY_TOKEN": "launchd-token"],
            token: "launchd-token",
            password: nil)

        let token = GatewayEndpointStore._testResolveGatewayToken(
            isRemote: true,
            root: [:],
            env: [:],
            launchdSnapshot: snapshot)
        #expect(token == nil)
    }

    @Test func `resolve gateway token uses remote config token`() {
        let token = GatewayEndpointStore._testResolveGatewayToken(
            isRemote: true,
            root: [
                "gateway": [
                    "remote": [
                        "token": "  remote-token  ",
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: nil)
        #expect(token == "remote-token")
    }

    @Test func `resolve gateway token skips unresolved placeholder and falls back to launchd`() {
        let snapshot = self.makeLaunchAgentSnapshot(
            env: ["OPENCLAW_GATEWAY_TOKEN": "launchd-token"],
            token: "launchd-token",
            password: nil)

        let token = GatewayEndpointStore._testResolveGatewayToken(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "token": "${OPENCLAW_GATEWAY_TOKEN}",
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: snapshot)
        #expect(token == "launchd-token")
    }

    @Test func `resolve gateway token resolves placeholder from process env`() {
        let snapshot = self.makeLaunchAgentSnapshot(
            env: ["OPENCLAW_GATEWAY_TOKEN": "launchd-token"],
            token: "launchd-token",
            password: nil)

        let token = GatewayEndpointStore._testResolveGatewayToken(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "token": "${OPENCLAW_GATEWAY_TOKEN}",
                    ],
                ],
            ],
            env: ["OPENCLAW_GATEWAY_TOKEN": "env-token"],
            launchdSnapshot: snapshot)
        #expect(token == "env-token")
    }

    @Test func `resolve gateway token returns nil for unresolvable placeholder`() {
        let token = GatewayEndpointStore._testResolveGatewayToken(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "token": "${UNKNOWN_VAR}",
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: nil)
        #expect(token == nil)
    }

    @Test func `resolve gateway token returns literal config token when not a placeholder`() {
        let token = GatewayEndpointStore._testResolveGatewayToken(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "token": "my-secret-token", // pragma: allowlist secret
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: nil)
        #expect(token == "my-secret-token")
    }

    @Test func `resolve gateway token returns lowercase env-braced literal as-is`() {
        // "${abc}" does not match the documented uppercase env-ref grammar
        // and must be preserved as a literal credential, not silently dropped.
        let token = GatewayEndpointStore._testResolveGatewayToken(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "token": "${abc}", // pragma: allowlist secret
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: nil)
        #expect(token == "${abc}")
    }

    @Test func `resolve gateway token returns digit-leading env-braced literal as-is`() {
        // "${123_VAR}" does not match the documented uppercase env-ref grammar
        // and must be preserved as a literal credential, not silently dropped.
        let token = GatewayEndpointStore._testResolveGatewayToken(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "token": "${123_VAR}", // pragma: allowlist secret
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: nil)
        #expect(token == "${123_VAR}")
    }

    @Test func `resolve gateway token returns mixed-case env-braced literal as-is`() {
        // "${OpenClaw_Token}" contains lowercase letters so it doesn't match
        // the documented uppercase-only env-ref grammar.
        let token = GatewayEndpointStore._testResolveGatewayToken(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "token": "${OpenClaw_Token}", // pragma: allowlist secret
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: nil)
        #expect(token == "${OpenClaw_Token}")
    }

    @Test func `resolve gateway token returns underscore first env braced literal as-is`() {
        // "${_SECRET}" — underscore-first env names are NOT recognized as
        // env placeholders by the macOS native resolver (they match the
        // TypeScript env-substitution pattern but not the SecretRef grammar).
        let token = GatewayEndpointStore._testResolveGatewayToken(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "token": "${_SECRET}", // pragma: allowlist secret
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: nil)
        #expect(token == "${_SECRET}")
    }

    @Test func `resolve gateway token skips dollar name shorthand and falls back to launchd`() {
        // $NAME is the documented SecretRef shorthand — must be treated
        // the same as ${NAME} for LaunchAgent fallback.
        let snapshot = self.makeLaunchAgentSnapshot(
            env: ["OPENCLAW_GATEWAY_TOKEN": "launchd-token"],
            token: "launchd-token",
            password: nil)

        let token = GatewayEndpointStore._testResolveGatewayToken(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "token": "$OPENCLAW_GATEWAY_TOKEN",
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: snapshot)
        #expect(token == "launchd-token")
    }

    @Test func `remote password resolver trims remote config password`() {
        let root: [String: Any] = [
            "gateway": [
                "remote": [
                    "password": "  remote-pass  ",
                ],
            ],
        ]

        #expect(GatewayRemoteConfig.resolvePasswordString(root: root) == "remote-pass")
    }

    @Test func `resolve gateway password falls back to launchd`() {
        let snapshot = self.makeLaunchAgentSnapshot(
            env: ["OPENCLAW_GATEWAY_PASSWORD": "launchd-pass"],
            token: nil,
            password: "launchd-pass")

        let password = GatewayEndpointStore._testResolveGatewayPassword(
            isRemote: false,
            root: [:],
            env: [:],
            launchdSnapshot: snapshot)
        #expect(password == "launchd-pass")
    }

    @Test func `resolve gateway password skips unresolved placeholder and falls back to launchd`() {
        let snapshot = self.makeLaunchAgentSnapshot(
            env: ["OPENCLAW_GATEWAY_PASSWORD": "launchd-pass"],
            token: nil,
            password: "launchd-pass")

        let password = GatewayEndpointStore._testResolveGatewayPassword(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "password": "${OPENCLAW_GATEWAY_PASSWORD}",
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: snapshot)
        #expect(password == "launchd-pass")
    }

    @Test func `resolve gateway password resolves placeholder from process env`() {
        let snapshot = self.makeLaunchAgentSnapshot(
            env: ["OPENCLAW_GATEWAY_PASSWORD": "launchd-pass"],
            token: nil,
            password: "launchd-pass")

        let password = GatewayEndpointStore._testResolveGatewayPassword(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "password": "${OPENCLAW_GATEWAY_PASSWORD}",
                    ],
                ],
            ],
            env: ["OPENCLAW_GATEWAY_PASSWORD": "env-pass"],
            launchdSnapshot: snapshot)
        #expect(password == "env-pass")
    }

    @Test func `resolve gateway password returns nil for unresolvable placeholder`() {
        let password = GatewayEndpointStore._testResolveGatewayPassword(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "password": "${UNKNOWN_VAR}",
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: nil)
        #expect(password == nil)
    }

    @Test func `resolve gateway password returns literal password when not a placeholder`() {
        let password = GatewayEndpointStore._testResolveGatewayPassword(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "password": "my-secret-password", // pragma: allowlist secret
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: nil)
        #expect(password == "my-secret-password")
    }

    @Test func `resolve gateway password returns lowercase env-braced literal as-is`() {
        // "${abc}" does not match the documented uppercase env-ref grammar
        // and must be preserved as a literal credential, not silently dropped.
        let password = GatewayEndpointStore._testResolveGatewayPassword(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "password": "${abc}", // pragma: allowlist secret
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: nil)
        #expect(password == "${abc}")
    }

    @Test func `resolve gateway password returns digit-leading env-braced literal as-is`() {
        // "${123_VAR}" does not match the documented uppercase env-ref grammar
        // and must be preserved as a literal credential, not silently dropped.
        let password = GatewayEndpointStore._testResolveGatewayPassword(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "password": "${123_PASS}", // pragma: allowlist secret
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: nil)
        #expect(password == "${123_PASS}")
    }

    @Test func `resolve gateway password skips dollar name shorthand and falls back to launchd`() {
        // $NAME is the documented SecretRef shorthand — must be treated
        // the same as ${NAME} for LaunchAgent fallback.
        let snapshot = self.makeLaunchAgentSnapshot(
            env: ["OPENCLAW_GATEWAY_PASSWORD": "launchd-pass"],
            token: nil,
            password: "launchd-pass")

        let password = GatewayEndpointStore._testResolveGatewayPassword(
            isRemote: false,
            root: [
                "gateway": [
                    "auth": [
                        "password": "$OPENCLAW_GATEWAY_PASSWORD",
                    ],
                ],
            ],
            env: [:],
            launchdSnapshot: snapshot)
        #expect(password == "launchd-pass")
    }

    @Test func `connection mode resolver prefers config mode over defaults`() {
        let defaults = self.makeDefaults()
        defaults.set("remote", forKey: connectionModeKey)

        let root: [String: Any] = [
            "gateway": [
                "mode": " local ",
            ],
        ]

        let resolved = ConnectionModeResolver.resolve(root: root, defaults: defaults)
        #expect(resolved.mode == .local)
    }

    @Test func `connection mode resolver trims config mode`() {
        let defaults = self.makeDefaults()
        defaults.set("local", forKey: connectionModeKey)

        let root: [String: Any] = [
            "gateway": [
                "mode": " remote ",
            ],
        ]

        let resolved = ConnectionModeResolver.resolve(root: root, defaults: defaults)
        #expect(resolved.mode == .remote)
    }

    @Test func `connection mode resolver falls back to defaults when missing config`() {
        let defaults = self.makeDefaults()
        defaults.set("remote", forKey: connectionModeKey)

        let resolved = ConnectionModeResolver.resolve(root: [:], defaults: defaults)
        #expect(resolved.mode == .remote)
    }

    @Test func `connection mode resolver falls back to defaults on unknown config`() {
        let defaults = self.makeDefaults()
        defaults.set("local", forKey: connectionModeKey)

        let root: [String: Any] = [
            "gateway": [
                "mode": "staging",
            ],
        ]

        let resolved = ConnectionModeResolver.resolve(root: root, defaults: defaults)
        #expect(resolved.mode == .local)
    }

    @Test func `connection mode resolver prefers remote URL when mode missing`() {
        let defaults = self.makeDefaults()
        defaults.set("local", forKey: connectionModeKey)

        let root: [String: Any] = [
            "gateway": [
                "remote": [
                    "url": " ws://umbrel:18789 ",
                ],
            ],
        ]

        let resolved = ConnectionModeResolver.resolve(root: root, defaults: defaults)
        #expect(resolved.mode == .remote)
    }

    @Test func `resolve local gateway host uses loopback for auto even with tailnet`() {
        let host = GatewayEndpointStore._testResolveLocalGatewayHost(
            bindMode: "auto",
            tailscaleIP: "100.64.1.2")
        #expect(host == "127.0.0.1")
    }

    @Test func `resolve local gateway host uses loopback for auto without tailnet`() {
        let host = GatewayEndpointStore._testResolveLocalGatewayHost(
            bindMode: "auto",
            tailscaleIP: nil)
        #expect(host == "127.0.0.1")
    }

    @Test func `resolve local gateway host prefers tailnet for tailnet mode`() {
        let host = GatewayEndpointStore._testResolveLocalGatewayHost(
            bindMode: "tailnet",
            tailscaleIP: "100.64.1.5")
        #expect(host == "100.64.1.5")
    }

    @Test func `resolve local gateway host falls back to loopback for tailnet mode`() {
        let host = GatewayEndpointStore._testResolveLocalGatewayHost(
            bindMode: "tailnet",
            tailscaleIP: nil)
        #expect(host == "127.0.0.1")
    }

    @Test func `resolve local gateway host uses custom bind host`() {
        let host = GatewayEndpointStore._testResolveLocalGatewayHost(
            bindMode: "custom",
            tailscaleIP: "100.64.1.9",
            customBindHost: "192.168.1.10")
        #expect(host == "192.168.1.10")
    }

    @Test func `local config uses local gateway auth and host resolution`() {
        let snapshot = self.makeLaunchAgentSnapshot(
            env: [:],
            token: "launchd-token",
            password: "launchd-pass")
        let root: [String: Any] = [
            "gateway": [
                "bind": "tailnet",
                "tls": ["enabled": true],
                "remote": [
                    "url": "wss://remote.example:443",
                    "token": "remote-token",
                ],
            ],
        ]

        let config = GatewayEndpointStore._testLocalConfig(
            root: root,
            env: [:],
            launchdSnapshot: snapshot,
            tailscaleIP: "100.64.1.8")

        #expect(config.url.absoluteString == "wss://100.64.1.8:\(GatewayEnvironment.gatewayPort())")
        #expect(config.token == "launchd-token")
        #expect(config.password == "launchd-pass")
    }

    @Test func `dashboard URL uses local base path in local mode`() throws {
        let config: GatewayConnection.Config = try (
            url: #require(URL(string: "ws://127.0.0.1:18789")),
            token: nil,
            password: nil)

        let url = try GatewayEndpointStore.dashboardURL(
            for: config,
            mode: .local,
            localBasePath: " control ")
        #expect(url.absoluteString == "http://127.0.0.1:18789/control/")
    }

    @Test func `dashboard URL skips local base path in remote mode`() throws {
        let config: GatewayConnection.Config = try (
            url: #require(URL(string: "ws://gateway.example:18789")),
            token: nil,
            password: nil)

        let url = try GatewayEndpointStore.dashboardURL(
            for: config,
            mode: .remote,
            localBasePath: "/local-ui")
        #expect(url.absoluteString == "http://gateway.example:18789/")
    }

    @Test func `dashboard URL prefers path from config URL`() throws {
        let config: GatewayConnection.Config = try (
            url: #require(URL(string: "wss://gateway.example:443/remote-ui")),
            token: nil,
            password: nil)

        let url = try GatewayEndpointStore.dashboardURL(
            for: config,
            mode: .remote,
            localBasePath: "/local-ui")
        #expect(url.absoluteString == "https://gateway.example:443/remote-ui/")
    }

    @Test func `dashboard URL uses fragment token and omits password`() throws {
        let config: GatewayConnection.Config = try (
            url: #require(URL(string: "ws://127.0.0.1:18789")),
            token: "abc123",
            password: "sekret") // pragma: allowlist secret

        let url = try GatewayEndpointStore.dashboardURL(
            for: config,
            mode: .local,
            localBasePath: "/control")
        #expect(url.absoluteString == "http://127.0.0.1:18789/control/#token=abc123")
        #expect(url.query == nil)
    }

    @Test func `dashboard URL can use native auth token override`() throws {
        let config: GatewayConnection.Config = try (
            url: #require(URL(string: "ws://127.0.0.1:18789")),
            token: nil,
            password: "sekret") // pragma: allowlist secret

        let url = try GatewayEndpointStore.dashboardURL(
            for: config,
            mode: .local,
            localBasePath: "/control",
            authToken: "device-token")
        #expect(url.absoluteString == "http://127.0.0.1:18789/control/#token=device-token")
        #expect(url.query == nil)
    }

    @Test func `dashboard URL skips unresolved placeholder token`() throws {
        let config: GatewayConnection.Config = try (
            url: #require(URL(string: "ws://127.0.0.1:18789")),
            token: "${OPENCLAW_GATEWAY_TOKEN}",
            password: nil)

        let url = try GatewayEndpointStore.dashboardURL(
            for: config,
            mode: .local,
            localBasePath: "/control")
        #expect(url.absoluteString == "http://127.0.0.1:18789/control/")
        #expect(url.fragment == nil)
    }

    @Test func `normalize gateway url adds default port for loopback ws`() {
        let url = GatewayRemoteConfig.normalizeGatewayUrl("ws://127.0.0.1")
        #expect(url?.port == 18789)
        #expect(url?.absoluteString == "ws://127.0.0.1:18789")
    }

    @Test func `normalize gateway url accepts private network ws`() {
        let url = GatewayRemoteConfig.normalizeGatewayUrl("ws://192.168.0.202:18789")
        #expect(url?.absoluteString == "ws://192.168.0.202:18789")
    }

    @Test func `normalize gateway url accepts tailnet ws`() {
        let url = GatewayRemoteConfig.normalizeGatewayUrl("ws://100.123.224.76:18789")
        #expect(url?.absoluteString == "ws://100.123.224.76:18789")
    }

    @Test func `missing transport infers direct from private remote URL`() {
        let root: [String: Any] = [
            "gateway": [
                "remote": [
                    "url": "ws://192.168.0.202:18789",
                ],
            ],
        ]

        let resolution = GatewayRemoteConfig.resolveTransportResolution(root: root)
        #expect(resolution.transport == .direct)
        #expect(resolution.source == .inferredRemoteURL)
        #expect(resolution.directURL?.absoluteString == "ws://192.168.0.202:18789")
    }

    @Test func `legacy loopback URL keeps SSH even with trusted SSH target`() {
        let root: [String: Any] = [
            "gateway": [
                "remote": [
                    "url": "ws://127.0.0.1:18789",
                    "sshTarget": "steipete@192.168.0.202",
                ],
            ],
        ]

        let resolution = GatewayRemoteConfig.resolveTransportResolution(root: root)
        #expect(resolution.transport == .ssh)
        #expect(resolution.source == .legacySSH)
        #expect(resolution.directURL == nil)
    }

    @Test func `explicit ssh keeps legacy tunnel even when target is direct capable`() {
        let root: [String: Any] = [
            "gateway": [
                "remote": [
                    "transport": "ssh",
                    "url": "ws://127.0.0.1:18789",
                    "sshTarget": "steipete@192.168.0.202",
                ],
            ],
        ]

        let resolution = GatewayRemoteConfig.resolveTransportResolution(root: root)
        #expect(resolution.transport == .ssh)
        #expect(resolution.source == .explicit)
        #expect(resolution.directURL == nil)
    }

    @Test func `normalize gateway url rejects public host ws`() {
        let url = GatewayRemoteConfig.normalizeGatewayUrl("ws://gateway.example:18789")
        #expect(url == nil)
    }

    @Test func `normalize gateway url rejects private ipv4 suffix host bypasses`() {
        #expect(GatewayRemoteConfig.normalizeGatewayUrl("ws://192.168.0.202.attacker.example:18789") == nil)
        #expect(GatewayRemoteConfig.normalizeGatewayUrl("ws://100.123.224.76.attacker.example:18789") == nil)
    }

    @Test func `normalize gateway url rejects ipv6 prefix hostname bypasses`() {
        #expect(GatewayRemoteConfig.normalizeGatewayUrl("ws://fcorp.example:18789") == nil)
        #expect(GatewayRemoteConfig.normalizeGatewayUrl("ws://fd-example.com:18789") == nil)
    }

    @Test func `normalize gateway url rejects prefix bypass loopback host`() {
        let url = GatewayRemoteConfig.normalizeGatewayUrl("ws://127.attacker.example")
        #expect(url == nil)
    }

    @Test func `resolve tls fingerprint trims remote config value`() {
        let root: [String: Any] = [
            "gateway": [
                "remote": [
                    "tlsFingerprint": " sha256:ABC123 ",
                ],
            ],
        ]

        #expect(GatewayRemoteConfig.resolveTLSFingerprint(root: root) == "sha256:ABC123")
    }

    @Test func `resolve tls fingerprint ignores blank or non string values`() {
        let blank: [String: Any] = [
            "gateway": [
                "remote": [
                    "tlsFingerprint": "   ",
                ],
            ],
        ]
        let nonString: [String: Any] = [
            "gateway": [
                "remote": [
                    "tlsFingerprint": 123,
                ],
            ],
        ]

        #expect(GatewayRemoteConfig.resolveTLSFingerprint(root: blank) == nil)
        #expect(GatewayRemoteConfig.resolveTLSFingerprint(root: nonString) == nil)
    }
}
