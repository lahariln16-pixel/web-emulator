const fs = require("fs");
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");

const SCOPES = [
    "https://www.googleapis.com/auth/drive.file"
];

const CREDENTIALS_PATH = path.join(
    process.cwd(),
    "credentials.json"
);

const TOKEN_PATH = path.join(
    process.cwd(),
    "token.json"
);

(async () => {

    try {

        console.log("Starting Google Drive authorization...");

        const auth = await authenticate({
            keyfilePath: CREDENTIALS_PATH,
            scopes: SCOPES
        });

        console.log("✅ Google authorization successful!");

        /*
         * Save the OAuth credentials locally.
         * token.json is already in .gitignore.
         */
        fs.writeFileSync(
            TOKEN_PATH,
            JSON.stringify(
                auth.credentials,
                null,
                2
            )
        );

        console.log("✅ OAuth token saved locally.");

        const accessTokenResult =
            await auth.getAccessToken();

        const accessToken =
            accessTokenResult.token;

        const response = await fetch(
            "https://www.googleapis.com/drive/v3/files",
            {
                method: "POST",

                headers: {
                    "Authorization":
                        `Bearer ${accessToken}`,

                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    name: "Emulator Downloads",
                    mimeType:
                        "application/vnd.google-apps.folder"
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {

            throw new Error(
                data.error?.message ||
                "Google Drive folder creation failed"
            );

        }

        console.log("");
        console.log("✅ Folder created!");
        console.log("Name:", data.name);
        console.log("Folder ID:", data.id);
        console.log("");

        fs.writeFileSync(
            "drive-config.json",
            JSON.stringify(
                {
                    folderId: data.id
                },
                null,
                2
            )
        );

        console.log(
            "✅ Folder ID saved to drive-config.json"
        );

    } catch (error) {

        console.error("");
        console.error(
            "❌ Google Drive setup failed:"
        );

        console.error(error.message);

        process.exit(1);

    }

})();
