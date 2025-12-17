import { Mail, Lock, User, UserCircle, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useAppDispatch } from "../store/hooks";
import { showToast } from "../store/slices/toastSlice";
import { API_BASE_URL, API_ENDPOINTS } from "../config/constants";

interface ValidationErrors {
  username?: string;
  email?: string;
  password?: string;
  fullName?: string;
}

export default function SignUp() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loadingSignUp, setLoadingSignUp] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});

  const validateUsername = (value: string): string | undefined => {
    if (!value) return "Username is required";
    if (value.length < 3) return "Username must be at least 3 characters";
    if (value.length > 50) return "Username must be less than 50 characters";
    if (!/^[a-zA-Z0-9_]+$/.test(value))
      return "Username can only contain letters, numbers, and underscores";
    return undefined;
  };

  const validateEmail = (value: string): string | undefined => {
    if (!value) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      return "Please enter a valid email address";
    return undefined;
  };

  const validatePassword = (value: string): string | undefined => {
    if (!value) return "Password is required";
    if (value.length < 8) return "Password must be at least 8 characters";
    return undefined;
  };

  const handleFieldBlur = (field: keyof ValidationErrors, value: string) => {
    let error: string | undefined;
    switch (field) {
      case "username":
        error = validateUsername(value);
        break;
      case "email":
        error = validateEmail(value);
        break;
      case "password":
        error = validatePassword(value);
        break;
    }
    setErrors((prev) => ({ ...prev, [field]: error }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const validationErrors: ValidationErrors = {
      username: validateUsername(username),
      email: validateEmail(email),
      password: validatePassword(password),
    };

    setErrors(validationErrors);

    // Check if there are any errors
    if (Object.values(validationErrors).some((error) => error !== undefined)) {
      dispatch(
        showToast({
          message: "Please fix the validation errors",
          type: "error",
        })
      );
      return;
    }

    setLoadingSignUp(true);
    try {
      const res = await fetch(API_BASE_URL + API_ENDPOINTS.REGISTER, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          email,
          password,
          fullName: fullName || undefined, // Send only if provided
        }),
      });

      const data = await res.json();
      setLoadingSignUp(false);

      if (res.status === 201 || res.status === 200) {
        dispatch(
          showToast({
            message: "Account created successfully! Please sign in.",
            type: "success",
          })
        );
        setTimeout(() => {
          navigate("/cloud-login");
        }, 1500);
      } else {
        dispatch(
          showToast({
            message: data.error || "Sign up failed. Please try again.",
            type: "error",
          })
        );
      }
    } catch (error) {
      console.error("Sign up failed", error);
      setLoadingSignUp(false);
      dispatch(
        showToast({
          message: "Network error. Please check your connection.",
          type: "error",
        })
      );
    }
  };

  return (
    <div className="flex flex-col h-full p-6">
      <button
        onClick={() => navigate("/cloud-login")}
        className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="text-sm">Back to Sign In</span>
      </button>

      <div className="flex-1 flex flex-col justify-center">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold mb-2">Create Account</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Join Snippy and sync across devices
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300"
            >
              Username *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={(e) => handleFieldBlur("username", e.target.value)}
                placeholder="username_123"
                required
                className={`w-full pl-10 pr-4 py-2.5 border rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 ${
                  errors.username
                    ? "border-red-500 focus:ring-red-500"
                    : "border-zinc-200 dark:border-zinc-800 focus:ring-gray-400 dark:focus:ring-gray-600"
                }`}
              />
            </div>
            {errors.username && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {errors.username}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="fullName"
              className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300"
            >
              Full Name
            </label>
            <div className="relative">
              <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
                className="w-full pl-10 pr-4 py-2.5 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300"
            >
              Email *
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={(e) => handleFieldBlur("email", e.target.value)}
                placeholder="your@email.com"
                required
                className={`w-full pl-10 pr-4 py-2.5 border rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 ${
                  errors.email
                    ? "border-red-500 focus:ring-red-500"
                    : "border-zinc-200 dark:border-zinc-800 focus:ring-gray-400 dark:focus:ring-gray-600"
                }`}
              />
            </div>
            {errors.email && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {errors.email}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300"
            >
              Password *
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={(e) => handleFieldBlur("password", e.target.value)}
                placeholder="••••••••"
                required
                className={`w-full pl-10 pr-4 py-2.5 border rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 ${
                  errors.password
                    ? "border-red-500 focus:ring-red-500"
                    : "border-zinc-200 dark:border-zinc-800 focus:ring-gray-400 dark:focus:ring-gray-600"
                }`}
              />
            </div>
            {errors.password && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {errors.password}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loadingSignUp}
            className={`w-full py-2.5 font-medium rounded-lg transition-colors ${
              loadingSignUp
                ? "bg-gray-400 dark:bg-gray-600 text-white cursor-not-allowed"
                : "bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 text-white dark:text-gray-900"
            }`}
          >
            {loadingSignUp ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Creating Account...
              </div>
            ) : (
              "Create Account"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
