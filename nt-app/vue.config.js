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
                artifactName: 'Noita-Together-Setup-${version}.${ext}',
                win: {
                    target: "nsis",
                    requestedExecutionLevel: "requireAdministrator" //eugh
                },
                nsis: {
                    perMachine: true,
                    oneClick: false,
                    allowToChangeInstallationDirectory: true
                },
                publish: ["github"]
            }
        }
    },
    filenameHashing: false
}
