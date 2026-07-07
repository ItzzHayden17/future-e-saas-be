import dotenv from "dotenv";
dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import nodemailer from "nodemailer";
import admin from "firebase-admin";
import serviceAccount from "./futur-e-docs-firebase-adminsdk-fbsvc-2f4fb93b31.json" with { type: "json" };
import multer from "multer";
import { Storage } from "@google-cloud/storage";

const router = express.Router();
const PORT = 8080;

const upload = multer({
    storage: multer.memoryStorage(),
});

const storage = new Storage({
  keyFilename: "./futur-e-docs-firebase-adminsdk-fbsvc-2f4fb93b31.json",
});

const bucket = storage.bucket("gs://futur-e-docs.firebasestorage.app");

async function uploadFile(pathToLocalFile, destination) {
  await bucket.upload(pathToLocalFile, {
    destination,
  });

  console.log("Uploaded:", destination);
}

export { uploadFile };


//firesbase init
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const transporter = nodemailer.createTransport({
    host: "cp68.domains.co.za",  // correct SMTP server
    port: 465,                    // SSL port
    secure: true,                 // true for 465, false for 587
    auth: {
        user: process.env.EMAIL_USER,  // e.g., no-reply@novexo.co.za
        pass: process.env.EMAIL_PASS   // email password
    }
});


router.post('/submit-form', async (req, res) => {
  console.log(req.body);
  
  const { name_surname, cellphone, type,email } = req.body;

  
  console.log(req.body);


  const mailOptions = {
    from: "no-reply@novexo.co.za",
    to: "marketing@futur-e.co.za",//"marketing@futur-e.co.za", // Who should receive it
    subject: 'New Lead from Future-e Contact Form',
    text: `Name: ${name_surname}\nCellphone: ${cellphone}\nType: ${type}\nEmail address: ${email}`,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.send(200)
    console.log("Email sent" );
  } catch (error) {
    console.error(error);
    res.status(500)
  }
});

router.get("/",(req,res)=>{
  res.send(200)
})

router.post("/login-admin", (req, res) => {
  console.log(req.body);
  const { username, password } = req.body;

  if (username === process.env.USER && password === process.env.PASS) {
    const success = true
    console.log("Valid login");
    
    res.json({ success });
  }else{
      res.json({ success: false });
    }
  
})

router.get("/under-construction", (req, res) => {
  res.json({underConstruction: false});
})

router.get("/companies", (req, res) => {  //get all companies from database
  const companies = [];

  async function fetchCompanies() {
    const snapshot = await db.collection('companies').get();
    snapshot.forEach(doc => {
      companies.push({ id: doc.id, ...doc.data() });
    });
    res.json(companies);
    console.log('Fetched companies: ', companies);
  }

  fetchCompanies()
})

router.get("/fleet-data", async (req, res) => {
  try {
    const snapshot = await db.collection("fleets").get();

    const fleets = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(fleets);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch fleet data" });
  }
});

router.post("/company-login", async (req, res) => {  //company login


  const snapshot = await db.collection('companies')
  .where('companyName', '==', req.body.companyName)
  .where('password', '==', req.body.password)
  .limit(1)
  .get();

if (!snapshot.empty) {
  const doc = snapshot.docs[0];   // first result
  res.json({ success: true, company: { id: doc.id, ...doc.data() } });
} else {
  console.log("No matching company found");
  res.json({ success: false });
}
    
});

router.post("/claims", upload.array("images",50),async (req, res) => {   //claim submission must go to email

  const {date_time,place,desc_other_vehicle,other_driver_details,owner_details,insurance_company_of_other_driver,witness_contact_details,police_officer_details,accident_description,companyName,accident_sketch} = req.body
  

  const imageAttachments = req.files.map(file => ({
    filename: file.originalname,
    content: file.buffer,
    contentType: file.mimetype
  }));

    const mailOptions = {
    from: process.env.EMAIL_USER,
    to: "claims@futur-e.co.za", // Who should receive it |   SONY.ANRAY743@GMAIL.COM
    subject: `New Claim from Future-e claims portal for ${companyName}`,
    text: `DATE, TIME, AND PLACE OF ACCIDENT: ${date_time}\n
           PLACE OF ACCIDENT: ${place}\n
           OTHER VEHICLE(S) DETAILS – MAKE(S), COLOUR(S) AND REGISTRATION NUMBER(S): ${desc_other_vehicle}\n
           OTHER DRIVER(S) DETAILS – NAME(S), SURNAME(S), ADDRESS(ES), PHONE NUMBER(S),ID NUMBER(S): ${other_driver_details}\n
           OWNER DETAILS (ONLY IF THE DRIVER IS NOT THE OWNER) – NAME, ADDRESS, PHONE NUMBER: ${owner_details}\n
           INSURANCE COMPANY(IES) – WITH WHICH THE OTHER VEHICLE(S) IS/ARE INSURED?: ${insurance_company_of_other_driver}\n
           NAME AND CONTACT DETAILS OF ANY WITNESS(ES): ${witness_contact_details}\n
           NAME AND STATION OF THE POLICE/TRAFFIC OFFICER – IF PRESENT: ${police_officer_details}\n
           GIVE A SHORT DISCRIPTION OF THE ACCIDENT: ${accident_description}\n 
           `,
    attachments: imageAttachments
           
  };
  

  try {
    await transporter.sendMail(mailOptions);
    res.send(200)
    console.log("claim sent" );
  } catch (error) {
    console.error(error);
    res.status(400)
 }
})

router.post("/add-company", upload.single("file"), async (req, res) => {
  try {
    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    // Create a reference to the file in GCS
    const fileName = `company_docs/${req.body.companyName}_Claim_Form.pdf`;
    const gcsFile = bucket.file(fileName);

    // Upload the buffer directly
    await gcsFile.save(req.file.buffer, {
      contentType: req.file.mimetype,
    });

    // Make the file public (optional, only if you want everyone to access it)
    // await gcsFile.makePublic();
    // const fileUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    // Or, generate a signed URL (valid for 1 year)
    const expires = Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 year
    const [fileUrl] = await gcsFile.getSignedUrl({
      action: "read",
      expires,
    });

    // Save company info to Firestore, including file URL
    const docRef = db.collection("companies").doc();
    await docRef.set({
      companyName: req.body.companyName,
      password: req.body.password,
      towingServiceNumber: req.body.towingServiceNumber,
      policyNumber: req.body.policyNumber,
      claimFormUrl: fileUrl,  // <-- store the URL here
    });

    res.sendStatus(200);
    console.log("Company added:", docRef.id);
    console.log("File URL:", fileUrl);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error uploading file");
  }
});

router.post("/edit-company", upload.single("file"), async (req, res) => {
  try {
    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    const { id, companyName, password, towingServiceNumber, policyNumber } = req.body;

    const updateData = {};
    if (companyName) updateData.companyName = companyName;
    if (password) updateData.password = password;
    if (towingServiceNumber) updateData.towingServiceNumber = towingServiceNumber;
    if (policyNumber) updateData.policyNumber = policyNumber;

    // If a new file is uploaded, save it to GCS and add the URL to updateData
    if (req.file) {
      const fileName = `company_docs/${companyName}_Claim_Form.pdf`;
      const gcsFile = bucket.file(fileName);

      await gcsFile.save(req.file.buffer, {
        contentType: req.file.mimetype,
      });

      // Generate a signed URL (1 year validity)
      const expires = Date.now() + 365 * 24 * 60 * 60 * 1000;
      const [fileUrl] = await gcsFile.getSignedUrl({
        action: "read",
        expires,
      });

      updateData.claimFormUrl = fileUrl;
    }

    // Update Firestore
    await db.collection("companies").doc(id).update(updateData);

    console.log("Company updated:", id);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating company");
  }
});

 router.post("/delete/:id",async (req,res)=>{
  const companyId = req.params.id;

  try {
    // reference to the document
    const docRef = db.collection("companies").doc(companyId);

    // check if doc exists
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Company not found" });
    }

    // delete it
    await docRef.delete();

    res.status(200).json({ message: "Company deleted successfully" });
  } catch (error) {
    console.error("Error deleting company:", error);
    res.status(500).json({ error: "Failed to delete company" });
  }
 })

 router.post("/fleet-login",async (req,res)=>{
  const {username,password} = req.body.data

  console.log(username,password);
  
  if (username === "admin" && password === "Futur-e") {
    console.log("Fleet login success");
    res.send({status:200,username})
  }
  
 })

 router.post("/edit-vehicle",async (req,res)=>{
  console.log(req.body)
  const snapshot = await db.collection("fleets").doc(req.body.id).update(req.body).then(()=>{
    res.sendStatus(200)
  }).catch((error)=>{
    console.log(error);
    res.sendStatus(500)
  })
 })

 router.post("/delete-vehicle",async (req,res)=>{
  await db.collection("fleets").doc(req.body.id).delete().then(()=>{
    res.sendStatus(200)
  }).catch((error)=>{
    console.log(error);
    res.sendStatus(500)
  })

})

router.post("/add-vehicle",async (req,res)=>{
  db.collection("fleets").add(req.body).then(()=>{
    res.sendStatus(200)
  }).catch((error)=>{
    console.log(error);
    res.sendStatus(500)
  })
  
})

export default router;