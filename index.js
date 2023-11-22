require("dotenv").config();
const express = require("express");
const app = express();
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.SECRET_KEY);
const cors = require("cors");
const port = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.esabfel.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const menuCollection = client.db("bistroDB").collection("menu");
    const reviewCollection = client.db("bistroDB").collection("reviews");
    const cartCollection = client.db("bistroDB").collection("carts");
    const userCollection = client.db("bistroDB").collection("users");
    const paymentCollection = client.db("bistroDB").collection("payments");

    // jwt related API

    // Token generation
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // middlewares

    const verifyToken = (req, res, next) => {
      // console.log("inside verifytoken", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded?.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // menu related API
    app.get("/api/v1/get-menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    app.post(
      "/api/v1/create/menu",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const menu = req.body;
        const result = await menuCollection.insertOne(menu);
        res.send(result);
      }
    );

    app.delete("/api/v1/delete/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    // review related API

    app.get("/api/v1/get-review", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    // Cart Collection

    app.post("/api/v1/create/food-item", async (req, res) => {
      const food = req.body;
      const result = await cartCollection.insertOne(food);
      res.send(result);
    });

    app.get("/api/v1/get-cart", async (req, res) => {
      const { email } = req.query;
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.delete("/api/v1/delete-item/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // users API

    app.post("/api/v1/create/user", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const isExist = await userCollection.findOne(query);
      if (isExist) {
        return res.send({ message: "user already exist" });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get("/api/v1/get-users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/api/v1/users/admin/:email", verifyToken, async (req, res) => {
      const { email } = req.params;
      if (email !== req.decoded?.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.delete(
      "/api/v1/delete-user/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };
        const result = await userCollection.deleteOne(query);
        res.send(result);
      }
    );

    app.patch(
      "/api/v1/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    // payment API

    app.post("/api/v1/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price) * 100 || 1;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get("/api/v1/get-payments/:email", async (req, res) => {
      const { email } = req.params;
      console.log(email);
      const query = { email: email };
      // console.log(query);
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/api/v1/payments", async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);

      const query = {
        _id: {
          $in: payment.cartIds.map((id) => new ObjectId(id)),
        },
      };
      const result = await cartCollection.deleteMany(query);
      res.send({ paymentResult, result });
    });

    // Admin Stats

    app.get("/api/v1/admin-stats", async (req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const menus = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      // this is not the best way
      // const payments = await paymentCollection.find().toArray();
      // const revenue = payments.reduce((total, item) => total + item.price, 0);

      // recommended way

      const result = await paymentCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: {
                $sum: "$price",
              },
            },
          },
        ])
        .toArray();
      const revenue = result.length > 0 ? result[0].totalRevenue : 0;
      res.send({ users, menus, orders, revenue });
    });

    app.get("/api/v1/order-stats", async (req, res) => {
      const result = await paymentCollection
        .aggregate([
          {
            $unwind: "$menuIds",
          },
          {
            $lookup: {
              from: "menu",
              localField: "menuIds",
              foreignField: "_id",
              as: "menuItems",
            },
          },
          {
            $unwind: "$menuItems",
          },
          {
            $group: {
              _id: "$menuItems.category",
              quantity: { $sum: 1 },
              price: { $sum: "$menuItems.price" },
            },
          },
          {
            $project: {
              _id: 0,
              category: "$_id",
              quantity: "$quantity",
              revenue: "$price",
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Bistro serving is running well");
});

app.listen(port, () => {
  console.log(`server is running on ${port}`);
});
