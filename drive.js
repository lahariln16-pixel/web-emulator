const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

let cachedDrive = null;

function getDriveClient() {

    if (cachedDrive) {
        return cachedDrive;
    }

    let clientId;
    let clientSecret;
    let refreshToken;
    let folderId;

    /*
     * Production: values come from Render environment variables.
     */
    if (
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REFRESH_TOKEN &&
        process.env.GOOGLE_DRIVE_FOLDER_ID
    ) {

        clientId =
            process.env.GOOGLE_CLIENT_ID;

        clientSecret =
            process.env.GOOGLE_CLIENT_SECRET;

        refreshToken =
            process.env.GOOGLE_REFRESH_TOKEN;

        folderId =
            process.env.GOOGLE_DRIVE_FOLDER_ID;

    }

    /*
     * Local development: use the files created
     * by drive-auth.js.
     */
    else {

        const credentials =
            JSON.parse(
                fs.readFileSync(
                    path.join(
                        __dirname,
                        "credentials.json"
                    ),
                    "utf8"
                )
            );

        const token =
            JSON.parse(
                fs.readFileSync(
                    path.join(
                        __dirname,
                        "token.json"
                    ),
                    "utf8"
                )
            );

        const config =
            JSON.parse(
                fs.readFileSync(
                    path.join(
                        __dirname,
                        "drive-config.json"
                    ),
                    "utf8"
                )
            );

        const oauth =
            credentials.installed ||
            credentials.web;

        clientId =
            oauth.client_id;

        clientSecret =
            oauth.client_secret;

        refreshToken =
            token.refresh_token;

        folderId =
            config.folderId;
    }

    if (
        !clientId ||
        !clientSecret ||
        !refreshToken ||
        !folderId
    ) {

        throw new Error(
            "Google Drive configuration is incomplete"
        );

    }

    const auth =
        new google.auth.OAuth2(
            clientId,
            clientSecret
        );

    auth.setCredentials({
        refresh_token: refreshToken
    });

    cachedDrive = {
        drive: google.drive({
            version: "v3",
            auth
        }),
        folderId
    };

    return cachedDrive;
}

async function uploadFile(
    filePath,
    filename
) {

    const {
        drive,
        folderId
    } = getDriveClient();

    console.log(
        `Uploading "${filename}" to Google Drive...`
    );

    const result =
        await drive.files.create({

            requestBody: {
                name: filename,
                parents: [folderId]
            },

            media: {
                mimeType:
                    "application/octet-stream",

                body:
                    fs.createReadStream(
                        filePath
                    )
            },

            fields:
                "id,name,webViewLink"

        });

    console.log(
        `✅ Uploaded "${filename}" to Google Drive`
    );

    return result.data;
}

module.exports = {
    uploadFile
};
