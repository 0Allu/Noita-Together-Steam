module.exports = {
    pluginOptions: {
        electronBuilder: {
            nodeIntegration: true,
            builderOptions: {
                productName: "Noita Together",
                // nt-steam-bridge + Steam API library, built by `yarn build:steam`
                // + the mod itself, installed into Noita by src/updater.js
                extraResources: [
                    { from: "resources/steam", to: "steam" },
                    { from: "../noita_mod", to: "noita_mod" }
                ],
                artifactName: 'Noita-Together-Steam-Setup.${ext}',
                win: {
                    target: "nsis",
                    requestedExecutionLevel: "requireAdministrator" //eugh
                },
                nsis: {
                    perMachine: true,
                    oneClick: false,
                    allowToChangeInstallationDirectory: true
                },
                // auto-update reads latest.yml from the newest release here
                publish: [{ provider: "github", owner: "0Allu", repo: "Noita-Together-Steam" }]
            }
        }
    },
    filenameHashing: false
}
