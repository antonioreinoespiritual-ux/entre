import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const SignupPage = () => {
  const navigate = useNavigate();
  const { signUp, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    const { error: signUpError } = await signUp(email, password);
    setSubmitting(false);

    if (signUpError) {
      setError(signUpError.message || 'No se pudo crear la cuenta');
      return;
    }

    navigate('/projects', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 space-y-5">
        <h1 className="text-2xl font-bold text-gray-900">Crear cuenta</h1>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg text-gray-900"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg text-gray-900"
          />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white" disabled={submitting || loading}>
          {submitting ? 'Creando...' : 'Crear cuenta'}
        </Button>

        <p className="text-sm text-gray-600">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-blue-600 font-medium">Inicia sesión</Link>
        </p>
      </form>
    </div>
  );
};

export default SignupPage;
