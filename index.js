import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import bodyParser from 'body-parser'
import admin from "firebase-admin";
import fs from 'fs'
import bcrypt from 'bcrypt'
import {files_and_folders} from './sample_data.js'
import axios from 'axios'
import nodemailer from "nodemailer";
import appARouter from "./appA/appA.js";

const app = express()
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); 
app.use(cors())
app.use(express.json());
app.use("/appA", appARouter); // Mount the appA router


app.use(bodyParser.json({ limit: '50mb' }));          // for JSON requests
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Allow CORS if form is served from another domain
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const PORT = process.env.PORT || 8080

dotenv.config()

function jwtAuth(req, res, next) {

    try {

        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                status: "error",
                message: "No authorization header"
            });
        }

        const token = authHeader.split(" ")[1];

        if (!token) {
            return res.status(401).json({
                status: "error",
                message: "No token provided"
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.user = decoded;

        console.log(
            `Authenticated: ${decoded.username}`
        );

        next();

    } catch (error) {

        console.error("JWT Error:", error.message);

        return res.status(401).json({
            status: "error",
            message: "Invalid or expired token"
        });
    }
}

function logHistory(route,action,user) {

    const historyEntry = {
        route,
        action,
        user,
        timestamp: new Date()
    }

    db.collection('history').add(historyEntry)
}

//the more this server grows, the more we will need to split it into multiple files and use a router to handle different routes. For now, we will keep it simple and just have one route.
//for now it is okay,will be a good learning expereince to branch out and split the code into multiple files and use a router to handle different routes. For now, we will keep it simple and just have one route.


const serviceAccount = JSON.parse(
  fs.readFileSync("secrets/futur-e-saas-firebase-adminsdk-fbsvc-3eac3fd621.json", "utf8")
);

const mainApp = admin.initializeApp(
  {
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "futur-e-saas-docs",
  },
  "main"
);

const db = mainApp.firestore();
const bucket = mainApp.storage().bucket();

const transporter = nodemailer.createTransport({
    host: "cp68.domains.co.za",  // correct SMTP server
    port: 465,                    // SSL port
    secure: true,                 // true for 465, false for 587
    auth: {
        user: process.env.EMAIL_USER,  // e.g., no-reply@novexo.co.za
        pass: process.env.EMAIL_PASS   // email password
    }
});

app

//get routes
.get('/server-status', (req, res) => {
  res.send('Hello World!')
})
.get('/clients', jwtAuth, async (req, res) => {
    try {
        const clientsSnapshot = await db.collection('clients').get()
        const clients = []
        clientsSnapshot.forEach(doc => {
            clients.push({ id: doc.id, ...doc.data() })
        })
        res.json(clients)
    } catch (error) {
        res.status(500).json({ message: 'Error fetching clients', status: 'error' })
    }
})

.get('/history', jwtAuth, async (req, res) => {
    try {
        const historySnapshot = await db.collection('history').orderBy('timestamp', 'desc').get()
        const history = []
        historySnapshot.forEach(doc => {
            history.push({ id: doc.id, ...doc.data() })
        })
        res.json(history)
    } catch (error) {
        res.status(500).json({ message: 'Error fetching history', status: 'error' })
    }
})
app.get("/api/files", jwtAuth, async (req, res) => {
  try {

    const path = req.query.path || "/root";

    const snapshot = await db
      .collection("nodes")
      .where("parentPath", "==", path)
      .get();

    const results = snapshot.docs.map(doc => doc.data());

    return res.json(results);

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: "Failed to fetch files"
    });
  }
})
app.get("/api/all-files", async (req, res) => {

  const snapshot =
    await db.collection("nodes").get();

  res.json(
    snapshot.docs.map(doc => doc.data())
  );

});

//New route for signed urls
app.get("/api/document/:id", async (req, res) => {
    try {

        const snapshot = await db
            .collection("nodes")
            .where("id", "==", req.params.id)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(404).json({
                error: "Document not found"
            });
        }

        const fileData = snapshot.docs[0].data();

        const storageFile =
            bucket.file(fileData.filePath);

        const [signedUrl] =
            await storageFile.getSignedUrl({
                action: "read",
                expires: Date.now() + 3600000
            });

        res.json({
            url: signedUrl
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: "Failed to generate URL"
        });
    }
})
//post routes
.post("/login", async (req, res) => {

    try {

        const { username, password } = req.body;

        console.log(`Login attempt: ${username}`);

        const userSnapshot =
            await db
                .collection("users")
                .where("username", "==", username)
                .limit(1)
                .get();

        if (userSnapshot.empty) {

            return res.status(401).json({
                status: "error",
                message: "Username not found"
            });
        }

        const userDoc =
            userSnapshot.docs[0];

        const user =
            userDoc.data();

        const match =
            await bcrypt.compare(
                password + process.env.PEPPER,
                user.password
            );

        if (!match) {

            return res.status(401).json({
                status: "error",
                message: "Invalid credentials"
            });
        }

        console.log(
            `Password verified for ${username}`
        );

        // ==========================
        // Generate OTP
        // ==========================

        const code =
            Math.floor(
                100000 + Math.random() * 900000
            ).toString();

        console.log(
            `Generated OTP: ${code}`
        );

        // ==========================
        // Save OTP
        // ==========================

        await db
            .collection("mfa_codes")
            .doc(userDoc.id)
            .set({
                code,
                expiresAt:
                    Date.now() + (5 * 60 * 1000),
                createdAt:
                    Date.now()
            });

        console.log(
            "OTP saved to Firestore"
        );

        // ==========================
        // Email OTP
        // ==========================

        console.log(
            `Sending OTP to ${user.email}`
        );

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: user.email,
            subject:
                "Futur-e Verification Code",
            html: `
                <div style="font-family: Arial, sans-serif;">
                    <h2>Futur-e Login Verification</h2>

                    <p>
                        Your verification code is:
                    </p>

                    <h1>
                        ${code}
                    </h1>

                    <p>
                        This code expires in 5 minutes.
                    </p>

                    <p>
                        If you did not request this login,
                        please ignore this email.
                    </p>
                </div>
            `
        });

        console.log(
            "OTP email sent successfully"
        );

        // ==========================
        // Return MFA Required
        // ==========================

        return res.json({
            status: "mfa_required",
            userId: userDoc.id,
            message:
                "Verification code sent"
        });

    } catch (error) {

        console.error(
            "LOGIN ERROR:"
        );

        console.error(error);

        return res.status(500).json({
            status: "error",
            message:
                error.message ||
                "Internal server error"
        });
    }
})
.post("/verify-token", (req, res) => {
    const { token } = req.body
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        res.json({ decoded, message: 'Token is valid', status: 'success' })
    } catch (err) {
        res.json({ message: 'Invalid token', status: 'error' })
    }
})

.post("/create-user", async (req, res) => {
    try {
        const { username, password ,email,admin,marketing} = req.body 
         const hash = await bcrypt.hash(password + process.env.PEPPER, 15)

        const rights = {
            user:true,
            admin:admin || false,
            marketing:marketing || false,
        }

        logHistory('/create-user',`created user with username ${username}`,req.body.user)

        await db.collection('users').add({ username, password: hash ,email , rights})
        
        res.json({ message: 'User created successfully', status: 'success' })
    } catch (error) {
        res.json({ message: 'Error creating user : ' + error.message, status: 'error' })
    }
})

.post("/add-client", jwtAuth, async (req, res) => {
    try {
        const { name, surname, idNumber, phoneNumber, email } = req.body
        console.log(name, surname, idNumber, phoneNumber, email);
        

        const newClient={
            name,
            surname,
            idNumber,
            phoneNumber,
            email  
        }

        logHistory('/add-client',`created client with id ${idNumber}`,req.body.user)

        await db.collection('clients').add(newClient)

        res.json({ message: 'Client added successfully', status: 'success' })
    } catch (error) {

        res.status(500).json({ message: 'Error adding client : ' + error.message, status: 'error' })
    }
})
app.post("/save-file", async (req, res) => {
    try {

        console.log("\n================ SAVE CALLBACK ================");
        console.log("Body:", JSON.stringify(req.body, null, 2));

        // Only process actual save events
        if (req.body.status !== 2 && req.body.status !== 6) {
            console.log("Ignoring status:", req.body.status);
            return res.json({ error: 0 });
        }

        console.log("Document Key:", req.body.key);
        console.log("File Type:", req.body.filetype);
        console.log("Download URL:", req.body.url);

        // ==========================================
        // DOWNLOAD FROM ONLYOFFICE
        // ==========================================

        const fileResponse = await axios.get(req.body.url, {
            responseType: "arraybuffer"
        });

        const originalBuffer = Buffer.from(fileResponse.data);


        console.log("Downloaded from OnlyOffice");
        console.log("Byte Length:", originalBuffer.length);

        // ========================================== 3
        // FIND FILE RECORD
        // ==========================================

const documentId = req.body.key.substring(0, 36);

console.log("Original Key:", req.body.key);
console.log("Document ID:", documentId);

const snapshot = await db
    .collection("nodes")
    .where("id", "==", documentId)
    .limit(1)
    .get();

        if (snapshot.empty) {
            throw new Error(
                `No file found for key ${req.body.key}`
            );
        }

        const fileDoc = snapshot.docs[0];
        const fileData = fileDoc.data();

        console.log("Firestore Doc Found");
        console.log("Firestore ID:", fileData.id);
        console.log("Stored Path:", fileData.filePath);

            const storageFile = bucket.file(fileData.filePath);

        // ==========================================
        // CONTENT TYPE
        // ==========================================

        let contentType = "application/octet-stream";

        switch (req.body.filetype) {
            case "docx":
                contentType =
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                break;

            case "xlsx":
                contentType =
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                break;

            case "pptx":
                contentType =
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation";
                break;

            case "txt":
                contentType = "text/plain";
                break;
        }

        // ==========================================
        // UPLOAD TO STORAGE
        // ==========================================

        await fileDoc.ref.update({
            saveStatus: "saving"
        });

        await storageFile.save(originalBuffer, {
            metadata: {
                contentType
            }
        });

        console.log("Upload Complete");

        // ==========================================
        // VERIFY EXISTS
        // ==========================================

        const [exists] = await storageFile.exists();

        console.log("File Exists:", exists);

        if (!exists) {
            throw new Error(
                "Upload completed but file does not exist in storage"
            );
        }

        // ==========================================
        // DOWNLOAD BACK FROM STORAGE
        // ==========================================

        const [firebaseBuffer] =
            await storageFile.download();


        console.log(
            "Firebase Download Size:",
            firebaseBuffer.length
        );

        const buffersMatch =
            originalBuffer.equals(firebaseBuffer);

        console.log(
            "Buffer Verification:",
            buffersMatch
        );

        if (!buffersMatch) {
            throw new Error(
                "Firebase file differs from OnlyOffice file"
            );
        }

        // ==========================================
        // METADATA
        // ==========================================

        const [metadata] =
            await storageFile.getMetadata();

        console.log("Storage Metadata:");
        console.log("Bucket:", bucket.name);
        console.log("Object:", storageFile.name);
        console.log("Metadata:", metadata);
        console.log({
            name: metadata.name,
            size: metadata.size,
            contentType: metadata.contentType,
            updated: metadata.updated,
            generation: metadata.generation
        });

        if (
            Number(metadata.size) !== originalBuffer.length
        ) {
            throw new Error(
                `Size mismatch. Storage=${metadata.size} Local=${originalBuffer.length}`
            );
        }

        // ==========================================
        // TEST ACCESS URLS
        // ==========================================

        const publicUrl =
            `https://storage.googleapis.com/${bucket.name}/${storageFile.name}`;

        console.log("Public URL:");
        console.log(publicUrl);

        try {

            const [signedUrl] =
                await storageFile.getSignedUrl({
                    action: "read",
                    expires: Date.now() + (60 * 60 * 1000)
                });

            console.log("Signed URL:");
            console.log(signedUrl);

            const signedResponse =
                await axios.get(signedUrl, {
                    responseType: "arraybuffer"
                });

            const signedBuffer =
                Buffer.from(signedResponse.data);

            console.log(
                "Signed URL Download Size:",
                signedBuffer.length
            );

            console.log(
                "Signed URL Verification:",
                originalBuffer.equals(signedBuffer)
            );

        } catch (signedErr) {

            console.error(
                "Signed URL Verification Failed:"
            );

            console.error(signedErr);
        }

        // ==========================================
        // UPDATE FIRESTORE
        // ==========================================

        await fileDoc.ref.update({
            updatedAt: new Date().toISOString(),
            lastEditedBy: "OnlyOffice",
            saveStatus: "saved"
        });

        console.log("Firestore Updated");

        // ==========================================
        // SUCCESS
        // ==========================================

        console.log("===============================================");
        console.log("SAVE VERIFIED SUCCESSFULLY");
        console.log("OnlyOffice -> Firebase -> Download -> Verified");
        console.log("===============================================\n");

        return res.json({ error: 0 });

    } catch (err) {

        console.error("\n========== SAVE ERROR ==========");
        console.error(err);
        console.error("================================\n");

        return res.json({
            error: 1
        });
    }
})
app.post("/send-sms", jwtAuth, async (req, res) => {
    console.log(req.body)
    
    try{ 
        const {message, numbers} = req.body;
        let apiKey = process.env.SMSAPIKEY;
        let apiSecret = process.env.SMSAPISECRET;
        let accountApiCredentials = apiKey + ':' + apiSecret;

        let buff = new Buffer.from(accountApiCredentials);
        let base64Credentials = buff.toString('base64');

        let requestHeaders = {
            headers: {
                'Authorization': `Basic ${base64Credentials}`,
                'Content-Type': 'application/json'
            }
        };

const requestData = {
    messages: numbers.map(number => ({
        content: message,
        destination: number
    }))
};

const response = await axios.post(
    'https://rest.smsportal.com/bulkmessages',
    requestData,
    requestHeaders
);

console.log(response.data);

return res.json({
    status: "success",
    data: response.data
});
            }catch(error){
                    console.error("Error sending SMS:", error);

    return res.status(500).json({
        status: "error",
        message: error.message
    });
            }
})
app.post("/send-email", jwtAuth, async (req, res) => {

try {

    const {
        emails,
        subject,
        message
    } = req.body;

    if (!emails || emails.length === 0) {
        return res.status(400).json({
            status: "error",
            message: "No recipients selected"
        });
    }

    const sendPromises = emails.map(email => {

        return transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject,
            html: `
                <div style="font-family:Arial;">
                    ${message.replace(/\n/g, "<br/>")}
                </div>
            `
        });

    });

    await Promise.all(sendPromises);

    res.json({
        status: "success",
        message: `Emails sent to ${emails.length} recipients`
    });

} catch (error) {

    console.error(error);

    res.status(500).json({
        status: "error",
        message: error.message
    });
}

})
app.post("/verify-email-otp", async (req, res) => {

    try {

        const {
            userId,
            code
        } = req.body;

        const otpDoc =
            await db
                .collection("mfa_codes")
                .doc(userId)
                .get();

        if (!otpDoc.exists) {

            return res.json({
                status: "error",
                message: "No OTP found"
            });
        }

        const otpData =
            otpDoc.data();

        if (
            Date.now() >
            otpData.expiresAt
        ) {

            return res.json({
                status: "error",
                message: "OTP expired"
            });
        }

        if (
            otpData.code !== code
        ) {

            return res.json({
                status: "error",
                message: "Invalid OTP"
            });
        }

        const userDoc =
            await db
                .collection("users")
                .doc(userId)
                .get();

        const token =
            jwt.sign(
                {
                    id: userDoc.id,
                    username:
                        userDoc.data().username
                },
                process.env.JWT_SECRET,
                {
                    expiresIn: "1h"
                }
            );

        await db
            .collection("mfa_codes")
            .doc(userId)
            .delete();

        res.json({
            status: "success",
            token
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            status: "error"
        });
    }
})
//patch routes

.patch("/update-client/:id", jwtAuth, async (req, res) => {
try {
        const { id } = req.params
    const { name, surname, idNumber, phoneNumber, email } = req.body
    console.log(id);
    

    const updatedClient = {
        name,
        surname,
        idNumber,
        phoneNumber,
        email
    }

    logHistory('/update-client',`updated client with id ${id}`,req.body.user)

    await db.collection('clients').doc(id).update(updatedClient)

    res.json({ message: 'Client updated successfully', status: 'success' })

} catch (error) {
    res.json({ message: 'Error updating client : ' + error.message, status: 'error' })
}
})
//put routes

//delete routes

.delete("/delete-client/:id", jwtAuth, async (req, res) => {
    
    try {

        const { id } = req.params
        logHistory('/delete-client',`deleted client with id ${id}`,req.body.user)
        await db.collection('clients').doc(id).delete()
        res.json({ message: 'Client deleted successfully', status: 'success' })

    } catch (error) {
        res.status(500).json({ message: 'Error deleting client: ' + error.message, status: 'error' })
    }
})

.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})