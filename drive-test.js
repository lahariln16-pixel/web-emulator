const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");

const SCOPES = [
    "https://www.googleapis.com/auth/drive.file"
];

(async () => {

    try {

        const auth = await authenticate({
            keyfilePath: path.join(
                process.cwd(),
                "credentials.json"
            ),
            scopes: SCOPES
        });

        console.log("✅ OAuth completed");

        const accessTokenResult =
            await auth.getAccessToken();

        const accessToken =
            accessTokenResult.token;

        console.log(
            "Access token available:",
            Boolean(accessToken)
        );

        console.log(
            "Credential fields:",
            Object.keys(auth.credentials || {})
        );

        if (!accessToken) {
            throw new Error(
                "No access token was produced"
            );
        }

        const response = await fetch(
            "https://www.googleapis.com/drive/v3/about?fields=user",
            {
                headers: {
                    Authorization:
                        `Bearer ${accessToken}`
                }
            }
        );

        console.log(
            "Drive HTTP status:",
            response.status
        );

        const data = await response.json();

        if (!response.ok) {
            console.log(
                "Drive error:",
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );

            return;
        }

        console.log("✅ Drive API works!");
        console.log(
            "Account:",
            data.user?.emailAddress
        );

    } catch (error) {

        console.error(
            "❌ Test failed:",
            error.message
        );

        if (error.response?.data) {
            console.error(
                JSON.stringify(
                    error.response.data,
                    null,
                    2
                )
            );
        }

    }

})();
