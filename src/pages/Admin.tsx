import React, { useState } from 'react';
    import { useForm } from 'react-hook-form';
    import { zodResolver } from '@hookform/resolvers/zod';
    import { z } from 'zod';
    import { toast } from 'react-toastify';
    import Header from '../components/Header';
    import Footer from '../components/Footer';

    const loginSchema = z.object({
      username: z.string().min(1, 'Username is required'),
      password: z.string().min(1, 'Password is required'),
    });

    type LoginForm = z.infer<typeof loginSchema>;

    const Admin: React.FC = () => {
      const [isLoggedIn, setIsLoggedIn] = useState(false);
      const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
        resolver: zodResolver(loginSchema),
      });

      const onLogin = (data: LoginForm) => {
        // Simulate login
        if (data.username === 'admin' && data.password === 'password') {
          setIsLoggedIn(true);
          toast.success('Logged in successfully!');
        } else {
          toast.error('Invalid credentials');
        }
      };

      if (!isLoggedIn) {
        return (
          <div className="min-h-screen bg-white flex items-center justify-center">
            <form onSubmit={handleSubmit(onLogin)} className="bg-gray-50 p-8 rounded-lg shadow-md space-y-4 w-full max-w-md">
              <h1 className="text-2xl font-bold text-center text-gray-900">Admin Login</h1>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  {...register('username')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500"
                />
                {errors.username && <p className="text-red-500 text-sm">{errors.username.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  {...register('password')}
                  type="password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500"
                />
                {errors.password && <p className="text-red-500 text-sm">{errors.password.message}</p>}
              </div>
              <button
                type="submit"
                className="w-full bg-gray-900 text-white py-3 rounded-lg hover:bg-gray-700 transition-colors"
              >
                Login
              </button>
            </form>
          </div>
        );
      }

      return (
        <div className="min-h-screen bg-white">
          <Header />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">Admin Panel</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              <div className="bg-gray-50 p-6 rounded-lg shadow-md">
                <h2 className="text-xl font-semibold mb-4">Manage Boxes</h2>
                <p className="text-gray-600">Add, edit, or remove loot boxes.</p>
                <button className="mt-4 bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors">
                  Manage
                </button>
              </div>
              <div className="bg-gray-50 p-6 rounded-lg shadow-md">
                <h2 className="text-xl font-semibold mb-4">Manage Prizes</h2>
                <p className="text-gray-600">Update prize inventory and details.</p>
                <button className="mt-4 bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors">
                  Manage
                </button>
              </div>
              <div className="bg-gray-50 p-6 rounded-lg shadow-md">
                <h2 className="text-xl font-semibold mb-4">View Orders</h2>
                <p className="text-gray-600">Check recent orders and statistics.</p>
                <button className="mt-4 bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors">
                  View
                </button>
              </div>
            </div>
          </main>
          <Footer />
        </div>
      );
    };

    export default Admin;