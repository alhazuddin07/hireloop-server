import express from "express";
import { MongoClient, ObjectId } from 'mongodb';
import cors from "cors";
import 'dotenv/config';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express()
const PORT = process.env.PORT || 5000

app.use(express.json());
app.use(cors());


const client = new MongoClient(`mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@ac-2ceakve-shard-00-00.m7iwz94.mongodb.net:27017,ac-2ceakve-shard-00-01.m7iwz94.mongodb.net:27017,ac-2ceakve-shard-00-02.m7iwz94.mongodb.net:27017/?ssl=true&replicaSet=atlas-uvob6j-shard-0&authSource=admin`);


const myLogger = async (req, res, next) => {
  console.log('now hitting api', req.url, req.headers);
  next();
}


export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
const db = connectedClient.db("hireloop");
const users = db.collection("user");
const sessions = db.collection("session");
const jobs = db.collection("jobs");
const applications = db.collection("applications");
const payments = db.collection('payments');

app.get('/', (req, res) => {
  res.send('Hello World!')
})

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).send({ message: 'Unauthorized' });
    return;
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    res.status(401).send({ message: 'Unauthorized' });
    return;
  }

  const query = { token };
  const session = await sessions.findOne(query);
  if (!session) {
    res.status(401).send({ message: 'Unauthorized' });
    return;
  }

  const userId = session.userId;

  const userQuery = { _id: new ObjectId(userId) };
  const user = await users.findOne(userQuery);
  if (!user) {
    res.status(401).send({ message: 'Unauthorized' });
    return;
  }

  req.user = user;
  next();

}

// must call this middleware after verifyToken
const verifySeeker = async(req, res, next) => {
  if(req.user.role !== 'seeker'){
    res.status(403).send({message: 'Forbidden'})
    return;
  }
  next();
}

const verifyRecruiter = async(req, res, next) => {
  if(req.user.role !== 'recruiter'){
    res.status(403).send({message: 'Forbidden'})
    return;
  }
  next();
}

const verifyAdmin = async(req, res, next)=>{
  if(req.user.role !== 'admin'){
    res.status(403).send({msg: 'Forbidden'})
    return;
  }
  next();
}


// users releted apis
app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  const result = await users.find().toArray();
  res.send(result);
})

app.get('/users/:id/premium', async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await users.findOne(query, { projection: { premium: 1 } });
  res.send(result);
});

app.patch('/users/:id/role', verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const updatedDoc = {
    $set: {
      role: req.body.role,
    }
  }
  const result = await users.updateOne(query, updatedDoc);
  res.send(result);
})

// jobs releted api
app.get('/jobs', async (req, res) => {

  const query = {};

  if (req.query) {
    if (req.query.jobType) {
      query.jobType = req.query.jobType;
    }
    if (req.query.isRemote) {
      query.isRemote = req.query.isRemote === 'true';
    }
    if (req.query.category) {
      query.category = req.query.category;
    }
    if (req.query.recruiterId) {
      query.recruiterId = req.query.recruiterId;
    }
    if (req.query.search) {
      query.$or = [
        { title: { $regex: req.query.search, $options: 'i' } },
        { responsibilities: { $regex: req.query.search, $options: 'i' } },
        { company: { $regex: req.query.search, $options: 'i' } },
        { requirments: { $regex: req.query.search, $options: 'i' } },
      ];
    }
  }

  const result = await jobs.find(query).toArray();
  res.send(result);

});

app.get('/jobs/:id', async (req, res) => {
  const id = req.params.id;
  const result = await jobs.findOne({ _id: new ObjectId(id) });
  res.send(result);
});

app.delete('/jobs/:id', async (req, res) => {
  const id = req.params.id;
  const result = await jobs.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

app.post('/jobs', verifyToken, verifyRecruiter, async (req, res) => {
  const data = req.body;
  const result = await jobs.insertOne(data);
  res.send(result);
});

// applications releted api
app.get('/applications', verifyToken, async (req, res) => {

  const query = {};

  if (req.query.applicantId) {
    query.userId = req.query.applicantId;
  }

  if (req.query.jobId) {

    const jobQuery = { _id: new ObjectId(req.query.jobId)};
    const job = await jobs.findOne(jobQuery);
    if(job.recruiterId !== req.user._id.toString() && req.user.role !== 'admin' ){
      res.status(403).send({ message: 'Forbidden'});
      return;
    }

    query.jobId = req.query.jobId;
  }

  const cursor = applications.find(query);
  const result = await cursor.toArray();
  res.send(result);
})
app.get('/applications/count', async (req, res) => {
  const query = {};

  if (req.query.applicantId) {
    query.userId = req.query.applicantId;
  }
  const result = await applications.countDocuments(query);
  res.send({ count: result });
})

app.post('/applications', verifyToken, verifySeeker, async (req, res) => {
  const data = req.body;
  const result = await applications.insertOne(data);
  res.send(result);
})

app.patch('/applications/:id', async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const updatedDoc = {
    $set: {
      status: req.body.status,
    }
  }

  const result = await applications.updateOne(query, updatedDoc);
  res.send(result)
})

// payments related api
app.post('/payments/checkout-verify', async (req, res) => {

  const { sessionId } = req.body;

  if (!sessionId) {
    return res.send({ success: false, message: 'Session ID is required' })
  }

  const {
    status,
    payment_status,
    customer_email,
    metadata,
    payment_intent,
  } = await stripe.checkout.sessions.retrieve(sessionId);

  if (status === 'complete' && payment_status === 'paid') {

    const sessionQuery = { sessionId };
    const existingPayment = await payments.findOne(sessionQuery);

    if (existingPayment) {
      return res.send({ success: false, message: 'Payment already verified' });
    }

    const payment = {
      sessionId,
      status,
      payment_status,
      customer_email,
      userId: metadata.userId,
      payment_date: new Date(),
      payment_intent,
    }

    const result = await payments.insertOne(payment);

    // update the user table
    const query = { _id: new ObjectId(metadata.userId) };

    const updateDoc = {
      $set: {
        premium: true,
      }
    }

    const updateResult = await users.updateOne(
      query,
      updateDoc
    );

    res.send({ success: true, result, updateResult });
    return
  }

  res.send({ success: false, message: 'Payment verification failed' });

})



app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

export default app;